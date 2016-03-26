var https = require('https'),
    fs = require('fs'),
    jsdom = require('node-jsdom').jsdom,
    sqlite3 = require('sqlite3'),
    winston = require('winston');

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

var TelegramPacketProcessor = function(config, db) {
	if (typeof db == "undefined") {
		var dbName = config['packets_database_name'] ? config['packets_database_name'] : 'telegram_bot_packets.db';
		db = new sqlite3.Database(dbName);
	} else if (typeof db == "string") {
		db = new sqlite3.Database(db);
	}

	if (!config) {
		config = {};
	}

	var URL = 						config['documentation_url'] ? config['documentation_url'] : "https://core.telegram.org/bots/api";
	var DOCUMENTATION_FILENAME = 	config['documentation_filename'] ? config['documentation_filename'] : "documentation.html";
	var DATABASE_SCHEMA_FILENAME = 	config['packets_database_schema'] ? config['packets_database_schema'] : "tables.json";

	var types = [
		"User",
		"Chat",
		"Message",
		"PhotoSize",
		"Audio",
		"Document",
		"Sticker",
		"Video",
		"Voice",
		"Contact",
		"Location",
		"Update",
		"InputFile",
		"UserProfilePhotos",
		"ReplyKeyboardMarkup",
		"ReplyKeyboardHide",
		"ForceReply",
		"File",
		"InlineQueryResultArticle",
		"InlineQueryResultPhoto",
		"InlineQueryResultGif",
		"InlineQueryResultMpeg4Gif",
		"InlineQueryResultVideo",
		"ChosenInlineResult"
	];

	function parseHtml(html) {
		var document = jsdom(html);

		function prepareName(name) {
			return name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
		}

		function parseTable(tbl, data) {
			var rows = tbl.getElementsByTagName("tr");
			var columns = {};
			for (var i = 1; i < rows.length; i++) {
				var tds = rows[i].getElementsByTagName("td");
				var columnName = tds[0].textContent;
				var columnType = tds[1].textContent;
				columns[columnName] = prepareName(columnType);
				var description = tds[2].textContent;
				if (/Unique(.+?)identifier/i.test(description)) {
					data['unique_id'] = columnName;
				}
			}
			data['columns'] = columns;
			return columns;
		}

		var headers = document.getElementsByTagName("h4");
		var tables = document.querySelectorAll("table.table");

		var sqlData = {};

		for (var i = 3; i < tables.length; i++) {
			var title = headers[i + 1].textContent;
			if (types.indexOf(title) > -1) {
				title = prepareName(title);
				sqlData[title] = {};
				parseTable(tables[i], sqlData[title]);
				sqlData[title].name = title;
			}
		}

		return sqlData;
	}


	function addRelation(table, columnName, relatedTableName) {
		if (!table['relations']) {
			table['relations'] = {};
		}
		table['relations'][columnName] = relatedTableName;
	}

	//here can change type value for diffent databases
	function prepareType(type, tables, currentTable, columnName) {
		switch (type) {
			case 'float': return 'real';
			case 'integer': return 'integer';
			case 'boolean':
			case 'true': return 'boolean';
			case 'string': return 'text';
			default:
				if (type.indexOf("array") != -1) {
					return "boolean";
				}
				if (type.indexOf(" or ") != -1) { //integer or string
					return "text";
				}
				if (type in tables) {
					addRelation(currentTable, columnName, type);
					return "integer";
				}
			return type;
		}
	}

	function prepareCreateTableQuery(tableName, currentTable, tables) {
		var columns = currentTable.columns;
		var queryColumns = [];
		if (!currentTable['unique_id']) {
			queryColumns.push('_id integer primary key autoincrement');
		}
		for (var columnName in columns) {
			var type = prepareType(columns[columnName], tables, currentTable, columnName);
			if (type !== false) {
				var sqlColumn = "`" + columnName + "` " + type;
				if (currentTable['unique_id'] == columnName) {
					sqlColumn += " primary key";
				}
				queryColumns.push(sqlColumn);
			}
		}
		var query = currentTable.query = "create table if not exists `" + tableName + "` (" + queryColumns.join(", ") + ");";
		return query;
	}

	function parseDocumentation(html) {
		var sqlData = parseHtml(html);
		for (var table in sqlData) {
			prepareCreateTableQuery(table, sqlData[table], sqlData);
		}
		return sqlData;
	}

	function download(callback) {
		https.get(URL, function(response) {
			var html = "";
			response.on('data', function(chunk) {
				html += chunk;
			}).on('end', function() {
				logger.info(html);
				fs.writeFileSync(DOCUMENTATION_FILENAME, html);
				if (typeof callback == "function") {
					callback(html);
				}
			});
		})
	}


	var tablesData = {};

	function processDocumentation(html) {
		var sqlData = parseDocumentation(html);
		prepareDatabase(sqlData);
		tablesData = sqlData;
		fs.writeFileSync(DATABASE_SCHEMA_FILENAME, JSON.stringify(sqlData));
	}


	function downloadAndPrepare() {
		download(processDocumentation);
	}

	function processDocumentationFromFile() {
		var html = fs.readFileSync(DOCUMENTATION_FILENAME);
		processDocumentation(html);
	}

	function prepareDatabase(tables) {
		for (var tableName in tables) {
			var query = tables[tableName].query;
			logger.info(query);
			db.run(query, function(error) {
				if (error) {
					logger.error(error);
				}
			});
		}
	}

	function insert(tableName, values, callback) {
		var keys = Object.keys(values);
		var params = {};
		keys.forEach(function(key) {
			params['$' + key] = values[key];
		});
		var query = "insert into `" + tableName + "` (`" + keys.join("`, `") +"`) values ($" + keys.join(", $") + ");";
		db.run(query, params, callback);
	}

	function insertOrReplace(tableName, values, uniqueFieldName, callback) {
		var uniqueId = values[uniqueFieldName];
		var keys = Object.keys(values);
		var params = {};
		keys.forEach(function(key) {
			params['$' + key] = values[key];
		});
		params['$' + uniqueFieldName] = uniqueId;
		var query = "insert or replace into `" + tableName + "` (`" + uniqueFieldName + "`, `" + keys.join("`, `") + "`) values ("
			+ "(select `" + uniqueFieldName + "` from `" + tableName + "` where `" + uniqueFieldName +"` = $" + uniqueFieldName + "), $" + keys.join(", $") + ");";
		// console.log(params);
		db.run(query, params, callback);
	}

	function saveValue(table, data, tableName, tables, callback) {
		var relations = table['relations'] ? table['relations'] : {};
		var columns = table['columns'];
		if (typeof data == "array") {
			for (var i = 0; i < data.length; i++) {
				saveValue(table, data[i], tableName, tables, callback);
			}
			return 1; //true
		} else if (typeof data == "object") {
			var values = {};
			for (var key in data) {
				var value = data[key];
				if (key in columns) {
					if (key in relations) {
						var relationTable = relations[key];
						if (relationTable in tables) {
							values[key] = saveValue(tables[relationTable], value, relationTable, tables, callback);
						}
					} else {
						values[key] = value;
					}
				}
			}

			var insertCallback = function(error) {
				if (error) {
					logger.error(error);
				}
				if (typeof callback == "function") {
					callback(error);
				}
			}

			if (table['unique_id']) {
				insertOrReplace(tableName, values, table['unique_id'], insertCallback);
				return data[table['unique_id']];
			} else {
				insert(tableName, values, insertCallback);
				return 0;
			}
		}
		return 0;
	}

	this.getTablesData = function() {
		return tablesData;
	}
	this.downloadAndPrepare = downloadAndPrepare;
	this.processDocumentationFromFile = processDocumentationFromFile;
	this.loadTablesData = function() {
		tablesData = JSON.parse(fs.readFileSync(DATABASE_SCHEMA_FILENAME));
	}

	this.savePacket = function(packet, callback) {
		var tables = tablesData;
		if (!tables) {
			logger.error('no tables data');
			return false;
		}
		if (typeof packet == "object") {
			for (var field in packet) {
				var table = tables[field];
				if (table) {
					var data = packet[field];
					saveValue(table, data, field, tables, callback);
				} else {
					if (field != 'update_id') {
						logger.error('no table ' + field);
					}
				}
			}
		}
	}

	this.saveRawPacket = function(json, callback) {
		try {
			var packet = JSON.parse(json);
			if (packet) {
				this.savePacket(packet, callback);
			}
		} catch (e) {
			logger.error(packet, e);
		}
	}

	this.getDbInstance = function() {
		return db;
	}
}

module.exports = TelegramPacketProcessor;
