#!/usr/bin/env node
// Отдаёт собранную игру (dist/) на localhost — и САМ ЗАВЕРШАЕТСЯ, когда закрыта
// последняя вкладка: страница держит открытым SSE-соединение /__alive, а его обрыв
// и есть «вкладку закрыли». Так после игры не остаётся фонового процесса.
//
// Запуск:  node scripts/serve-game.mjs [порт]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const PORT = Number(process.env.MURDOKU_PORT ?? process.argv[2] ?? 4173)
/** Сколько ждать после закрытия последней вкладки. С запасом: в это окно должны
 *  укладываться перезагрузка страницы (⌘R) и переподключение после сна Mac. */
const IDLE_MS = 15_000
/** Сколько ждать первого подключения: холодный старт браузера бывает небыстрым. */
const STARTUP_MS = 90_000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// Вкладка открывает это соединение и держит его, пока живёт. EventSource сам
// переподключается после перезагрузки страницы — её покрывает IDLE_MS.
const KEEPALIVE_JS = `new EventSource('/__alive')\n`

const clients = new Set()
let everConnected = false
let lastSeen = Date.now()

const server = createServer(async (req, res) => {
  lastSeen = Date.now() // любой запрос = браузер жив, отменяет отложенный выход
  const path = new URL(req.url ?? '/', 'http://localhost').pathname

  if (path === '/__alive') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(': ok\n\n')
    clients.add(res)
    everConnected = true
    const ping = setInterval(() => res.write(': ping\n\n'), 30_000)
    const drop = () => {
      clearInterval(ping)
      clients.delete(res)
      lastSeen = Date.now()
    }
    res.on('close', drop)
    res.on('error', drop)
    return
  }

  if (path === '/__alive.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' })
    res.end(KEEPALIVE_JS)
    return
  }

  // Статика из dist/ — без выхода за её пределы.
  let file = normalize(join(ROOT, decodeURIComponent(path)))
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (path.endsWith('/')) file = join(file, 'index.html')

  let body
  try {
    body = await readFile(file)
  } catch {
    // Единственная страница приложения: всё неизвестное — это index.html.
    file = join(ROOT, 'index.html')
    try {
      body = await readFile(file)
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.txt'] })
      res.end('Сборка не найдена — выполните npm run build')
      return
    }
  }

  if (extname(file) === '.html') {
    const html = body.toString('utf8')
    const tag = '<script src="/__alive.js"></script>'
    body = html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(body)
})

server.on('error', (err) => {
  console.error(`[murdoku] сервер не поднялся на ${PORT}: ${err.message}`)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[murdoku] http://localhost:${PORT} — закрытие последней вкладки завершит сервер`)
})

// Никого нет дома — выходим, чтобы не висеть фоновым процессом.
setInterval(() => {
  if (clients.size > 0) return
  const idleFor = Date.now() - lastSeen
  if (idleFor > (everConnected ? IDLE_MS : STARTUP_MS)) {
    console.log(`[murdoku] вкладок не осталось — выходим (простой ${Math.round(idleFor / 1000)} с)`)
    process.exit(0)
  }
}, 2_000).unref?.()

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => process.exit(0))
}
