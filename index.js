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
const wss = new WebSocket.WebSocketServer({ port: config.port });

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
          });
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

            events = [...events, ...body.events?.map(i => ["EVENT", data[1], i])];
          } catch {}
        }

        for (i of events) {
          if (!openSub.has(data[1])) break;
          s(ws, i);
        }

        if (openSub.has(data[1])) s(ws, ["CLOSED", data[1], ""])
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
