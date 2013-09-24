//secure web socket server + http(s) server; by ST0RM@Teligent

//TODO: escape() всех сообщений клиенту? или только от клиентов клиентам? или оставить на совесть клиентам т.к. серверу не мешает?, webrtc - sip organize, user registration, mongo? db, user rights, write system logs to files (to preserve and analyse later)

//NOTICE: возвращает все типы ответов как элементы массива, которые клиент разбирает по наличию ключевых слов

var webSocketServer = (function () {

	//includes
	var cWebSocketServer = require('websocket').server;
	var cHttp = require('http');
	var cHttps = require('https');
	var fs = require('fs');
	var url = require('url');
	var path = require("path");

	//config
	var config = require("./server-config.js").config;

	//internal variables
	var clientNamePattern = new RegExp('^[' + config.clientNamePattern + ']+$', 'i');
	var httpServer = null;
	var httpsServer = null;
	var wsServer = null;
	var clients = [];
	var serverHosts = [].concat(config.hosts); //our valid serverHosts for clients and which we are listen
	var serverIPs = [].concat(config.ips);
	var authUsers = [].concat(config.basicAuth);

	var originIsAllowed = function (originForCheck, requestHost) {
		console.log('Checking origin ', originForCheck, ' for allowance');
		var originFound = false;
		//проверка по хостам, если заданы
		if(serverHosts[0] != '*') {
			serverHosts.forEach(function (host) {
				console.log('checking origin', originForCheck, 'against host https://' + host + ':' + config.httpsPort );
				if('https://' + host + ':' + config.httpsPort == originForCheck) {
					originFound = true;
					return false;
				}
			});
		}
		//проверка по хосту в запросе, если конкретные хосты сервера  не заданы
		else if('https://' + requestHost == originForCheck) {
			originFound = true;
		}
		return originFound;
	};

	//chat history module
	var history = (function () {
		var messages = [];
		
		return {
			add: function (message) {
				var d = new Date();
				message['time'] = d.getTime();
				messages.push(message);
				if(messages.length > 100) {
					messages.shift();
				}
			},
			getAll: function () {
				if(messages.length) {
					return messages;
				}
				else {
					return [];
				}
			},
			getLast: function () {
				if(messages.length) {
					return messages[messages.length-1];
				}
				return {};
			},
			clearAll: function () {
				messages = [];
			}
		}
	})();
	
	//если уже соединённый с сервером клиент с таким именем
	var clientNameExists = function (name) {
		var nameFound = false;
		clients.forEach(function (client, index) {
			if(client['data']['name'] == name) {
				nameFound = true;
				return false;
			}
		});
		if(nameFound) {
			return true;
		}
		return false;
	};
	
	//тестирует имя клиента на валидность
	var clientNameInvalid = function (clientName) {
		if(clientNameExists(clientName)) {
			return 'This name has already taken.';
		}
		else if(!clientNamePattern.test(clientName)) {
			return 'Incorrect symbols in name.';
		}
		else if(clientName.length > config.clientNameMaxChars) {
			return 'Name must be not longer than ' + config.clientNameMaxChars + ' characters.';
		}
		return false;
	};

	//universal callback to our sendings
	var sendCallback = function (err) {
		if (err) console.error("send() error: " + err);
	};
	
	var sendError = function (clientObject, messageText, messageType) {
		clientObject.send(JSON.stringify([{
			'error': messageText,
			'type': messageType
		}]), sendCallback);
	};

	//broadcasting clients names to chat
	var broadcastClientNames = function () {
		var clientNames = [];
		var noneConnected = true;
		clients.forEach(function (client, index) {
			if (client.connected) {
				noneConnected = false;
				clientNames.push(client['data']['name']);
			}
		});
		
		if(noneConnected) {
			return;
		}

		clients.forEach(function (client, index) {
			if (client.connected) {
				client.send(JSON.stringify([{'clients': clientNames}]));
			}
		});
	};

	return {
		initialize: function () {
			
			//checking cert files
			var httpsOptions = {};
			if(fs.existsSync(config.cert.key)) {
				httpsOptions['key'] = fs.readFileSync(config.cert.key);
				httpsOptions['cert'] = fs.readFileSync(config.cert.cert);
				if(config.cert['ca']) {
					httpsOptions['ca'] = [];
					[].concat(config.cert['ca']).forEach(function (ca, idx) {
						httpsOptions['ca'].push(fs.readFileSync(ca));
					});
				}
			}
			else if(fs.existsSync(config.cert.pfx)) {
				httpsOptions['pfx'] = fs.readFileSync(config.cert.pfx);
			}
			else {
				console.err('No certificate files found. Exiting.');
				return -1;
			}

			//http server creation for redirects to https only
			httpServer = cHttp.createServer(function(request, response) {
				console.log((new Date()) + 'http connection from ', request.connection.remoteAddress, ': request.headers.host=', request.headers.host, request.headers['user-agent']);
				if(request.headers.host) {
					var newLocation = 'https://'+request.headers.host.replace(/(:\d{1,5})?$/, ':'+config.httpsPort)+request.url;
					console.log('redirecting to https from ', request.url, ' to ', newLocation);
					response.writeHead(301, {"Location": newLocation});
				}
				else {
					response.write("404 Not Found\n");
				}
				response.end();
			});
			
			//http server port binding
			serverIPs.forEach(function (serverIP) {
				httpServer.listen(config.httpPort, (serverIP != '*'?serverIP:null), function() {
					console.log((new Date()) + "Http server is listening on ip:", serverIP, 'and port:', config.httpPort);
				});
				if(serverIP == '*') {
					return false;
				}
			});
			
			//https server creation
			httpsServer = cHttps.createServer(httpsOptions, function(request, response) {
				console.log((new Date()) + ' Received request from ', request.connection.remoteAddress, ' for ' + request.url, request.headers['user-agent']);
				
				//авторизация, если в конфиге задан хоть один юзер
				if(authUsers.length) {
					var rheader=request.headers['authorization']||'',        // get the header
						atoken=rheader.split(/\s+/).pop()||'',            // and the encoded auth token
						aauth=new Buffer(atoken, 'base64').toString(),    // convert from base64
						aaparts=aauth.split(':'),                          // split on colon
						username=aaparts[0],
						password=aaparts[1],
						userPassed = false;

					console.log('got users', authUsers,' checking auth header', rheader,atoken,aauth, aaparts);

					authUsers.forEach(function (userObject) {
						if(userObject.username == username && userObject.password == password) {
							userPassed = true;
							return;
						}
					});
					if(!userPassed) {
						response.writeHead(401,{'WWW-Authenticate': 'Basic realm="Secure Area"'});
						
						response.end('Need authorization.');
						return;
					}
				}
				
				var uri = url.parse(request.url).pathname;
				var filename = path.join(process.cwd()+'/../client', uri.replace('..', ''));//protected from pathes widh ".." in url

				fs.exists(filename, function(exists) {
					if(!exists) {
						console.log(filename, 'is NOT found in fs, returning 404');
						response.writeHead(404, {"Content-Type": "text/plain"});
						response.write("Not Found.\n");
						response.end();
						return;
					}

					if (fs.statSync(filename).isDirectory()) {
						if(request.url.slice(-1) != '/') {
							//редирект на завершающий слеш
							response.writeHead(301, { "Location": request.url+'/' });
							response.end();
							return;
						}
						else {
							//TODO: пока захардкоденый документиндекс 
							filename += 'index.html';
						}
					}

					console.log(filename, 'is found in fs');

					fs.readFile(filename, "binary", function(err, file) {
						if(err) {
							
							console.log('errror while reading ', filename);
							
							response.writeHead(500, {"Content-Type": "text/plain"});
							response.write(err + "\n");
							response.end();
							return;
						}
						
						console.log(filename, 'readed from fs');

						var headers = {};
						var contentType = config.contentTypesByExtension[path.extname(filename)];
						if (contentType) headers["Content-Type"] = contentType;
						headers["Content-length"] = file.length;
								
						console.log('pushing headers to client ', headers);
						response.writeHead(200, headers);
						console.log('pushing file content to client ');
						response.write(file, "binary");
						console.log('ending response to client ');
						response.end();
					});
				});
				
				
			});

			//https server port binding
			serverIPs.forEach(function (serverIP) {
				httpsServer.listen(config.httpsPort, (serverIP != '*'?serverIP:null), function() {
					console.log((new Date()) + "Https server is listening on ip:", serverIP, 'and port:', config.httpsPort);
				});
				if(serverIP == '*') {
					return false;
				}
			});
			
			//web socket server creation over http server
			wsServer = new cWebSocketServer({
				httpServer: httpsServer,
				// You should not use autoAcceptConnections for production
				// applications, as it defeats all standard cross-origin protection
				// facilities built into the protocol and the browser.  You should
				// *always* verify the connection's origin and decide whether or not
				// to accept it.
				autoAcceptConnections: false
			});
			
			//web socket connection request from client handling
			wsServer.on('request', function(request) {
				if (!originIsAllowed(request.origin, request.httpRequest.headers.host)) {
					// Make sure we only accept requests from an allowed origin
					console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
					request.reject();
					return;
				}
				
				var connection = request.accept(null, request.origin);
				console.log((new Date()) + ' Connection accepted from ' + connection.remoteAddress, ' Origin:', request.origin);

				connection['data'] = { 'name': false };
				
				clients.push(connection);
				
				console.log('Number of connected clients: ', clients.length);
				


				// This is the most important callback for us, we'll handle
				// all messages from users here.
				connection.on('message', function(message) {
					var justGotName = false;
					var senderName = false; //имя(ид текущего клиента)
					var incomingData = false; //распарсенные пришедшие данные
					var systemCommand = false; //системная команда
					var clientNameError = false; //если имя клиента неправильное, тут будет ошибка
					if (message.type === 'utf8') {
						// process WebSocket message
						console.log((new Date()) + ' Received Message ' + message.utf8Data);
						
						incomingData = JSON.parse(message.utf8Data);
						
						//находится клиент, получаются дополнительные данные (или заполняется имя)
						clients.forEach(function (client, index) {
							//присвоение имени клиенту
							if(client == connection) {
								if(!client['data']['name'] && typeof incomingData['name'] != 'undefined') {
									senderName = incomingData['name'];
									clientNameError = clientNameInvalid(senderName);
									if(clientNameError) {
										sendError(client, clientNameError, 'disconnect');
										connection.close();
										return;
									}

									client['data']['name'] = senderName;
									
									justGotName = true;

									//отправка клиенту общей истории
									client.send(JSON.stringify(history.getAll()), sendCallback);
								}
								else {
									senderName = client['data']['name'];
								}
								return false;
							}
						});

						//Обновление истории
						if(justGotName) {
							//обновление общей истории сообщением о подключении клиента
							history.add({'message': 'Connected '+ senderName});
							//отправка всем актуального клиентлиста
							broadcastClientNames();
						}
						else {
							
							//валидация текстового сообщения от юзера
							if(incomingData['message']) {
								if(incomingData['message'].length > config.clientTextMessageMaxChars) {
									sendError(client, 'Message is longer then '+ config.clientTextMessageMaxChars + ' characters.', 'warning');
									return;
								}
							}
							
							if(incomingData['message'] && !incomingData['to']) {
								//системное сообщение TODO: пока не защищённое правами админа
								if(incomingData['message'].charAt(0) == '/') {
									systemCommand = true;
									
									//ду самсинг ниат
									switch(incomingData['message']) {
										case '/deleteHistory':
											history.clearAll();
											connection.send(JSON.stringify([{'system': 'History cleared.'}]), sendCallback);
										break;
									}
								}
								else {
									history.add({'senderName': senderName, 'message': incomingData['message']});
								}
							}
						}

						//рассылка сообщений
						if(!systemCommand) {
							clients.forEach(function (client, index) {
								var allowSend = false;
								var content = [];
								
								//разруливается приватность сообщения
								if(!incomingData['to']) {
									allowSend = true;
								}
								else {
									//сообщение конкретным юзерам
									[].concat(incomingData['to']).forEach(function (clientName, index) {
										if(client['data']['name'] == clientName) {
											allowSend = true;
										}
									});
								}
								
								//разруливается содержание сообщения
								if(incomingData['message'] || justGotName) {
									//обычное сообщение
									if(!incomingData['to']) {
										//публичное
										content.push(history.getLast());
									}
									else {
										//приватное
										//TODO: добавить серверное время в сообщение
										content.push({'message': incomingData['message'], 'senderName': senderName, 'private': true});
									}
								}
								['sdp', 'candidate', 'terminate'].forEach(function (msgType) {
									if(incomingData[msgType]) {
										var outMsg = { 'senderName': senderName };
										outMsg[msgType] = incomingData[msgType];
										content.push(outMsg);
									}
								});

								//отсылка того, что получилось
								if(allowSend && content) {
									client.send(JSON.stringify(content), sendCallback);
								}
							});
						}

					}
					//с бинарной датой пока ничего не делаем
// 					else if (message.type === 'binary') {
// 						console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
// 
// 						clients.forEach(function (client) {
// 							if (client != connection) {
// 								client.sendBytes(message.binaryData, sendCallback);
// 							}
// 						});
// 					}
				});

				connection.on('close', function(status) {
					// close user connection
					console.log((new Date()) + " Peer disconnected.");

					//ищем, кто отрубился
					clients.forEach(function (client, index) {
						var name = false;
						if (!client.connected) {
							
							//удаляем его из массива клиентов
							clients.splice(index, 1);
							
							name = client['data']?client['data']['name']:false;

							//если у отрубившегося было имя, надо всем рассказать что он отрубился
							if(name) {
								
								//обновление истории
								history.add({'message': 'Disconnected '+ name});
								console.log((new Date()) + " Disconnected", name);
								//сообщение что отрубился клиент для других клиентов, если у клиента есть наши данные (т.е. клиент был в чате, а не реджектился сразу из-за каких-нибудь проблем)
								clients.forEach(function (clientTo, clientToIndex) {
									if (clientTo.connected && clientTo['data']) {
										clientTo.send(JSON.stringify([history.getLast()]), sendCallback);
									}
								});
							}
						}
					});
					broadcastClientNames();
					
					console.log('Number of connected clients: ', clients.length);
				});
			});
		}
	};
})();

webSocketServer.initialize();
