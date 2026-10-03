import http from "node:http"

const port = Number(process.env.PORT ?? 8787)

function decide(workPackage) {
  const text = `${workPackage.description ?? ""}\n${workPackage.prompt ?? ""}`.toLowerCase()

  if (/(architecture|design|migration|schema|public api|cross-cutting)/.test(text)) {
    return {
      model: "opus",
      confidence: 0.72,
      reason: "Mock Kev: architecture/contract signal",
      shouldSplit: false,
    }
  }

  if (text.length < 900 && /(single function|one function|validator|mapper|converter|add test|write test|rename)/.test(text)) {
    return {
      model: "haiku",
      confidence: 0.76,
      reason: "Mock Kev: short closed-looking unit",
      shouldSplit: false,
    }
  }

  return {
    model: "sonnet",
    confidence: 0.61,
    reason: "Mock Kev: moderate implementation/integration work",
    shouldSplit: false,
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/decide") {
    res.writeHead(404).end()
    return
  }

  let body = ""
  req.setEncoding("utf8")
  req.on("data", (chunk) => {
    body += chunk
  })
  req.on("end", () => {
    try {
      const input = JSON.parse(body)
      const output = decide(input.workPackage ?? {})
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(output))
    } catch {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "invalid json" }))
    }
  })
})

server.listen(port, "127.0.0.1", () => {
  console.log(`mock Kev listening on http://127.0.0.1:${port}/decide`)
})
