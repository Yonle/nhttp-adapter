const config = require("./config");
const cluster = require("cluster");
const os = require("os");

if (!process.env.NO_CLUSTERS && cluster.isPrimary) {
  const numClusters = process.env.CLUSTERS || config.clusters || (os.availableParallelism ? os.availableParallelism() : (os.cpus().length || 2))

  console.log(`Primary ${process.pid} is running. Will fork ${numClusters} clusters.`);

  // Fork workers.
  for (let i = 0; i < numClusters; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Forking another one....`);
    cluster.fork();
  });

  return true;
}

const WebSocket = require("ws");
let got = import("got").then(_ => got = _.got);
const http = require("http");
const server = http.createServer();
const wss = new WebSocket.WebSocketServer({ server });

server.on('request', (req, res) => {
  return res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  }).end(JSON.stringify(config.server_meta || {
    "contact": "unset",
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000000",
    "description": "nhttp adapter.",
    "name": "nhttp",
    "software": "git+https://github.com/Yonle/nhttp_adapter",
    "supported_nips": [1,2,9,11,12,15,16,20,22,33,40,50],
    "version": require("./package.json").version
  }));
});

const s = (w, m) => w.send(JSON.stringify(m));
wss.on('connection', ws => {
  const openSub = new Set();
  ws.on('message', async data => {
    try {
      data = JSON.parse(data);
    } catch {
      return s(ws, ["NOTICE", "error: bad JSON"]);
    }

    switch (data[0]) {
      case "EVENT":
        for (i of config.nhttp_urls) {
          got.post(i + "/publish", {
            json: data[1]
          }).json().then(body => {
            if (body.notice) s(ws, ["NOTICE", body.notice]);
          }).catch(console.error);
        }
        s(ws, ["OK", data[1], true, ""]);
        break;
      case "REQ": {
        if ((typeof data[1] !== "string") || (typeof data[2] !== "object")) return s(ws, ["CLOSED", data[1], "invalid: invalid request"]);
        openSub.add(data[1]);
        let events = [];

        for (i in data[2]) {
          if (!Array.isArray(data[2][i])) continue;
          data[2][i] = data[2][i].join(",");
        }

        for (i of config.nhttp_urls) {
          if (!openSub.has(data[1])) break;
          try {
            const body = await got(i + "/req", {
              searchParams: data[2]
            }).json();

            if (body.status !== 0) continue;
            if (body.notice) s(ws, ["NOTICE", body.notice]);

            events = [...events, ...body.results?.map(i => ["EVENT", data[1], i])];
          } catch (e) {
            console.error(e)
          }
        }

        for (i of events) {
          if (!openSub.has(data[1])) break;
          s(ws, i);
        }

        if (openSub.has(data[1])) {
          s(ws, ["EOSE", data[1]]);
          s(ws, ["CLOSED", data[1], ""]);
        }
        openSub.delete(data[1]);

        break;
      }

      case "CLOSE":
        openSub.delete(data[1]);
        s(ws, ["CLOSED", data[1], ""]);
        break;
      default:
        s(ws, ["NOTICE", "error: unknown command"]);
        break
    }
  });

  ws.on('error', Function());
  console.log("A client has connected to an adapter.");
});

process.on('unhandledRejection', console.error);

const listener = server.listen(config.port, _ => console.log("Adapter is now listening on port", listener.address().port));
