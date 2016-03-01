var http = require('http');
var https = require('https');
var fs = require('fs');
var sqlite3 = require('sqlite3');
var TelegramApi = require('node-telegram-bot-api');
var TelegramPacketProcessor = require('./telegram_packet_processor.js');

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
  var main = JSON.parse(fs.readFileSync('config.json'));
  var files = fs.readdirSync("./");
  for (var i = 0; i < files.length; i++) {
    var filename = files[i];
    if (fs.statSync("./" + filename).isFile() && /config-(.+?)\.json/i.test(filename)) {
      try {
        var config = JSON.parse(fs.readFileSync(filename));
        main = mergeObjects(main, config);
      } catch (e) {
        console.log(e);
      }
    }
  }
  return main;
}());

console.log("config", config);

var options = {
  key: fs.readFileSync(config.cert["private"]),
  cert: fs.readFileSync(config.cert["public"]),
};

var bot = new TelegramApi(config.token, {polling: false});
var db = new sqlite3.Database(config.database);
var packetsProcessor = new TelegramPacketProcessor(config);
// packetsProcessor.downloadAndPrepare();
packetsProcessor.processDocumentationFromFile();
// packetsProcessor.loadTablesData();

db.run("create table if not exists raw_packets (data text);");

var publicCert = fs.createReadStream(config.cert["public"]);
console.log("set webhook to domain " + config.domain);
bot.setWebHook(config.domain, publicCert);

function saveRaw(data) {
  db.run("insert into raw_packets (data) values (?);", [data], function(error) {
    if (error) {
      console.log(error);
    }
  });
}

function processQuery(message) {
  if (message['from']['id'] == '111106900' || message['chat']['id'] == '-119508392') {
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
            console.error(error);
          } else {
            // console.log(data);
            var result = [];
            var cnt = Math.min(data.length, 11);
            for (var i = 0; i < cnt; i++) {
              if (i == 0) {
                result.push(Object.keys(data[i]).join("\t"));
              }
              var line = [];
              for (var key in data[i]) {
                console.log(key, data[i][key]);
                line.push(data[i][key]);
              }
              result.push(line.join("\t"));
            }
            console.log(result);
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

console.log("starting server on port " + config.port);
https.createServer(options, function(request, response) {
  var headers = request.headers;
  var method = request.method;
  var url = request.url;
  var body = [];
  request.on('error', function(err) {
    console.error(err);
  }).on('data', function(chunk) {
    body.push(chunk);
  }).on('end', function() {
    body = Buffer.concat(body).toString();
    response.on('error', function(err) {
      console.error(err);
    });

    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');    
    
    if (method = 'POST' /* && url == '/' + config.token */) {
      console.log(body);      
      saveRaw(body);      
      try {
        var packet = JSON.parse(body);
        packetsProcessor.savePacket(packet);
        if ('message' in packet && 'from' in packet.message && 'text' in packet.message) {
          console.log(packet['message']['from']['first_name'], packet['message']['text']);
          processQuery(packet['message']);
        }
      } catch (e) {
        console.error(e);
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
 
