var http = require('http'),
    https = require('https'),
    fs = require('fs'),
    winston = require('winston'),
    sqlite3 = require('sqlite3'),
    TelegramApi = require('node-telegram-bot-api'),
    TelegramPacketProcessor = require('./telegram_packet_processor.js');
// TODO usejsdoc.org

/**
 * We can even send logs to a cloud service (e. g. loggly or smth)
 * See https://github.com/winstonjs/winston/blob/master/docs/transports.md
 * By default it doesn't print debug-level log
 * More on loglevels: https://github.com/winstonjs/winston#logging-levels
 */
var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.File)({
      name: 'info-file',
      filename: 'logger.log',
      level: 'info'
    }),
    new (winston.transports.Console)({
      name: 'info-console',
      level: 'info',
      colorize: true,
      timestamp: true
    })
  ]
});

function mergeObjects(a, b) {
  var result = {};
  for (var key in a) {
    result[key] = a[key];
  }
  for (var key in b) {
    result[key] = b[key];
  }
  return result;
}

var config = (function parseConfigs(){
  var main = JSON.parse(fs.readFileSync('./etc/config.json'));
  var files = fs.readdirSync("./etc/");
  for (var i = 0; i < files.length; i++) {
    var filename = files[i];
    if (fs.statSync("./etc/" + filename).isFile() && /(w*)config-(.+?)\.json/i.test(filename)) {
      try {
        var config = JSON.parse(fs.readFileSync("./etc/" + filename));
        main = mergeObjects(main, config);
      } catch (e) {
        logger.error(e);
      }
    }
  }
  return main;
}());

logger.info("config", config);

if (!config.polling)
{
    var options = {
      key: fs.readFileSync(config.cert["private"]),
      cert: fs.readFileSync(config.cert["public"]),
    };
}

var bot = new TelegramApi(config.token, {polling: config.polling}); logger.log("debug", "BOTOK");
var db = new sqlite3.Database(config.database); logger.log("debug", "DBOK");
var packetsProcessor = new TelegramPacketProcessor(config); logger.log("debug", "PPCOK");
// packetsProcessor.downloadAndPrepare();
// packetsProcessor.processDocumentationFromFile();
packetsProcessor.loadTablesData();

db.run("create table if not exists raw_packets (data text);");

var publicCert = null;
if (!config.polling)
{
    publicCert = fs.createReadStream(config.cert["public"]);
    logger.info("set webhook to domain " + config.domain);
    bot.setWebHook(config.domain, publicCert);
}

function saveRaw(data) {
  db.run("insert into raw_packets (data) values (?);", [data], function(error) {
    if (error) {
      logger.error(error);
    }
  });
}

function checkAccess(message) {
  var chatId = message['chat']['id'],
      userId = message['from']['id'],
      access = config['access'];
  return access === true || (typeof access == "object" && access instanceof Array && (
    access.indexOf(chatId) != -1 || access.indexOf(userId) != -1
  ));
}

function processQuery(message) {
  if (checkAccess(message)) {
    if (message['text']) {
      var chatId = message['chat']['id'];
      var text = message['text'];
      if (/^select.+/i.test(text)) {
        var restrictedWords = ["insert", "update", "replace", "drop", "delete"];
        for (var i = 0; i < restrictedWords.length; i++) {
          if (text.indexOf(restrictedWords[i]) != -1) {
            bot.sendMessage(chatId, "давай вот не будем");
            return false;
          }
        }
        var db = packetsProcessor.getDbInstance();
        text += ";";
        db.all(text, [], function(error, data) {
          if (error) {
            bot.sendMessage(chatId, "error " + error);
            logger.error(error);
          } else {
            // logger.info(data);
            var result = [];
            var cnt = Math.min(data.length, 11);
            for (var i = 0; i < cnt; i++) {
              if (i == 0) {
                result.push(Object.keys(data[i]).join("\t"));
              }
              var line = [];
              for (var key in data[i]) {
                logger.info(key, data[i][key]);
                line.push(data[i][key]);
              }
              result.push(line.join("\t"));
            }
            logger.info(result);
            if (result.length > 0) {
              bot.sendMessage(chatId, result.join("\n"));
            } else {
              bot.sendMessage(chatId, "пусто");
            }
          }
        })
      }
    }
  }
}

if (!config.polling)
{
    logger.info("starting server on port " + config.port);
    https.createServer(options, function(request, response) {
      var headers = request.headers;
      var method = request.method;
      var url = request.url;
      var body = [];
      request.on('error', function(err) {
        logger.error(err);
      }).on('data', function(chunk) {
        body.push(chunk);
      }).on('end', function() {
        body = Buffer.concat(body).toString();
        response.on('error', function(err) {
          logger.error(err);
        });

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');

        if (method = 'POST' /* && url == '/' + config.token */) {
          logger.info(body);
          saveRaw(body);
          try {
            var packet = JSON.parse(body);
            packetsProcessor.savePacket(packet);
            if ('message' in packet && 'from' in packet.message && 'text' in packet.message) {
              logger.info(packet['message']['from']['first_name'], packet['message']['text']);
              processQuery(packet['message']);
            }
          } catch (e) {
            logger.error(e);
          }
        }
        var responseBody = {
          headers: headers,
          method: method,
          url: url,
          body: body
        };
        response.end();
      });
    }).listen(config.port);
}
else {
    bot.on('message', function (msg) {
        processQuery(msg);
    });
}
