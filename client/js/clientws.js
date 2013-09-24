//secure web socket client; by ST0RM@Teligent
//TODO: mute(audio, video), disconnect video from client , handle remote disconnection, handle video parameters(like hz), own inputed in textarea messages history for repeat by pressing up button (ui module); videochat broken within two clients(instances) in one window ; sound notifications on chat events (can be disabled in options), file transfers, chat rooms, authorization
//   window.onbeforeunload = function() { //handle/send terminate call private message through socket and autohung call if remote user disconnects from general chat
//     sendMessage({type: 'bye'});
//   }

//вебсокет клиент (полностью независимая фабрика)
var webSocketClient = function () {

	var instance = (function () {
		var wssServerURL = null; //адрес сервера
		var wss = null; //будущий объект вебсокета
		var eventListeners = {}; //набор коллбэков на события
		
		//запускает по событиям повешенные на них коллбэки
		var fireCallbacks = function (context, eventType, eventData) {
			var listener;
			for(listener in eventListeners) {
				if(typeof eventListeners[listener] == 'function') {
					eventListeners[listener].call(context, eventType, eventData);
				}
			}
		};

		return {
			connected: function () {
				return (wss != null && wss.readyState == 1)?true:false;
			},
			//callback - главный коллбэк на события вебсокет-соединения
			connect: function (serverURL) {

				//попытка соединиться в процессе существующего соединения
				if(wss != null && wss.readyState == 1) {
					console.warn("Already connected", wss.readyState);
					return;
				}
				
				//попытка соединиться, когда ещё недоотсоединялось
				if(wss != null && wss.readyState == 2) {
					console.warn("Disconnecting in process", wss.readyState);
					return;
				}

				wssServerURL = serverURL;
				wss = new WebSocket(wssServerURL);

				wss.onopen = function(event) {
					console.log("Connection opened ", event);
					fireCallbacks(this, 'opened', event);
				};
				
				wss.onclose = function(event) {
					console.log("Connection closed ", event, wss);
					fireCallbacks(this, 'closed', event);
				};
				
				wss.onerror = function(event) {
					console.log("Connection error ", event);
					wss.close();
					fireCallbacks(this, 'error', event);
				};
				
				wss.onmessage = function(event) {
					console.log("Message received ", event); 
					fireCallbacks(this, 'message', event);
				};
			},
			disconnect: function () {
				if(wss == null || wss.readyState == 2 || wss.readyState == 3) {
					return;
				}
				console.log("Closing connection with ", wssServerURL);
				//если есть недоотправленные данные - ожидание их доотправки.
				if(wss.bufferedAmount) {
					console.log("Data being sended found while closing connection. Waiting.. ", wssServerURL);
					setTimeout(function () {
						instance.disconnect();
					}, 500);
					return;
				}
				wss.close();
			},
			send: function (data) {
				if(wss == null || wss.readyState != 1) {
					return;
				}
				console.log("Sending message to ", wssServerURL, data);
				wss.send(data);
			},
			addEventListener: function (id, handler) {
				if(eventListeners[id]) {
					console.warn('Wss event listener with id ' + id + ' is already exists. Remove old first.');
					return -1;
				}
				eventListeners[id] = handler;
				return 0;
			},
			removeEventListener: function (id) {
				delete eventListeners[id];
			}
		};
	})();
	
	return instance;
};

//работа с медиаданными (полностью независимый объект)
var media = (function () {
	var initialized = false;
	var streamSource = null;
	var streamObjectURL = null;
	var getUserMedia = null;
	var attachMediaStream = null;
	
	// getUserMedia
	if (window.navigator.webkitGetUserMedia) {
		getUserMedia = window.navigator.webkitGetUserMedia.bind(navigator);
		
		attachMediaStream = function(element, stream) {
			element.src = webkitURL.createObjectURL(stream);
		};
	}
	else if (window.navigator.mozGetUserMedia) {
		getUserMedia = window.navigator.mozGetUserMedia.bind(navigator);
		
		attachMediaStream = function(element, stream) {
			element.mozSrcObject = stream;
		};
	}
	else if (window.navigator.getUserMedia) {
		getUserMedia = window.navigator.getUserMedia.bind(navigator);
		
		attachMediaStream = function(element, stream) {
			element.src = stream;
		};
	}

	return {
		myStream: function () {
			return streamSource;
		},
		initialize: function (callback) {
			if(!initialized) {
				
				var mediaToGet = { 
					"video": true/*{
						"mandatory": {
							
						},
						"optional": [
							{ "maxFrameRate": "30" },
							{ "maxWidth": "640" },
							{ "maxHeight": "480" }
						]
					}*/,
					'audio': true
				};
				var successCallback = function (stream) {
					streamSource = stream;
					initialized = true;
					
					callback.call(this, 'success', mediaToGet, streamSource);
				};
				var errorCallback = function (err) {
					console.log('error while getting media stream: ', err);
					if(mediaToGet.video == false) {
						//если попытка получить только аудио уже была, придётся вызывать коллбэк с ошибкой
						callback.call(this, 'error', mediaToGet, err);
					}
					else {
						//попытка получить только аудио
						mediaToGet.video = false;
						getUserMedia(mediaToGet, successCallback, errorCallback);
					}
				};
				//попытка получить и аудио, и видео
				getUserMedia(mediaToGet, successCallback, errorCallback);
			}
			else {
				callback.call(this, 'success', mediaToGet, streamSource);
			}
		},
		
		initialized: function () {
			return initialized;
		},
		
		getUserMedia: getUserMedia,
		
		attachMediaStream: attachMediaStream
	};
})();

//виджет вебчата (использует объекты, обозначенные выше)
var webChatWidget = function (webChatInstanceID, webChatInstanceConfig) {

	var instance  = (function (instanceID, instanceConfig) {

		//внутренний конфиг
		var configVersion = 1;

		//служебные переменные
		var unreadedMessagesCount = 0;
		var clientIDvalue = false; //имя себя
		var wssClient = null;
		var mediaCall = null;
		var mouseX = 0, mouseY = 0;
		
		var clientID = function (newClientID) {
			if(typeof newClientID != 'undefined' && newClientID != null) {
				clientIDvalue = newClientID;
			}
			return clientIDvalue;
		};

		var sendMessage = function (messageText) {
			wssClient.send(JSON.stringify({ 'message': messageText }));
		};

		//работа с интерфейсом (для веб-чата)
		var ui = (function () {

			var state = 'disconnected'; //connected, connecting, disconnecting, disconnected

			var webChatInstanceEl = null,
				clientIDEl = null,
				connectButtonEL = null,
				settingsButtonEl = null,
				smileSelectButtonEl = null,
				textToSendEl = null,
				sendTextButtonEl = null,
				smileContainerEl = null,
				userListEl = null,
				chatLogEl = null,
				userVideosContainerEl = null;
			
			var smiles = {
				'angel': '(angel)',
				'angry': '(angry)',
				'bandit': '(bandit)',
				'bear': ['(bear)', '(hug)'],
				'beer': '(beer)',
				'bigsmile': ['(bigsmile)', ':D', ':-D'],
				'blush': '(blush)',
				'bow': '(bow)',
				'brokenheart': '(brokenheart)',
				'bug': '(bug)',
				'cake': '(cake)',
				'call': '(call)',
				'cash': ['(cash)', '($)'],
				'clapping': '(clapping)',
				'coffee': '(coffee)',
				'cool': ['(cool)', '8)', '8-)', 'B)', 'B-)'],
				'crying': ['(crying)', ';(', ';-('],
				'dance': '(dance)',
				'devil': '(devil)',
				'doh': '(doh)',
				'drink': '(drink)',
				'drunk': '(drunk)',
				'dull': '(dull)',
				'emo': '(emo)',
				'envy': '(envy)',
				'evilgrin': ['(evilgrin)', '>:)'],
				'flower': '(flower)',
				'fubar': '(fubar)',
				'giggle': ['(giggle)', '(chuckle)'],
				'handshake': '(handshake)',
				'happy': '(happy)',
				'headbang': '(headbang)',
				'heart': '(heart)',
				'heidy': '(heidy)',
				'hi': '(hi)',
				'inlove': '(inlove)',
				'itwasntme': '(itwasntme)',
				'kiss': ['(kiss)', ':*', ':-*'],
				'lipssealed': ['(lipssealed)', ':x', ':-x', ':X', ':-X'],
				'mail': '(mail)',
				'makeup': ['(makeup)', '(kate)'],
				'malthe': '(malthe)',
				'middlefinger': '(middlefinger)',
				'mmm': '(mmm)',
				'mooning': '(mooning)',
				'movie': '(movie)',
				'muscle': '(muscle)',
				'music': '(music)',
				'nerd': ['(nerd)', '8|', '8-|'],
				'ninja': '(ninja)',
				'nod': '(nod)',
				'no': ['(no)', '(n)', '(N)'],
				'party': '(party)',
				'phone': '(phone)',
				'pizza': '(pizza)',
				'poolparty': '(poolparty)',
				'priidu': '(priidu)',
				'puke': ['(puke)', ':&', ':-&'],
				'punch': '(punch)',
				'rain': '(rain)',
				'rock': '(rock)',
				'rofl': '(rofl)',
				'sadsmile': ['(sadsmile)',':(',':-('],
				'shake': '(shake)',
				'sleepy': '(sleepy)',
				'smile': ['(smile)',':)',':-)'],
				'smirk': '(smirk)',
				'smoke': ['(smoke)', '(smoking)', '(ci)'],
				'speechless': ['(speechless)', ':|', ':-|'],
				'star': '(star)',
				'sun': '(sun)',
				'swear': '(swear)',
				'sweating': '(sweating)',
				'talking': '(talking)',
				'tauri': '(tauri)',
				'thinking': '(thinking)',
				'time': '(time)',
				'tmi': '(tmi)',
				'toivo': '(toivo)',
				'tongueout': ['(tongueout)', ':p', ':-p', ':P', ':-P'],
				'wait': '(wait)',
				'whew': '(whew)',
				'wink': ['(wink)', ';)', ';-)'],
				'wondering': ['(wondering)', ':^)'],
				'worried': '(worried)',
				'yawn': '(yawn)',
				'yes': ['(yes)', '(y)', '(Y)']
			};

			//пробежать по всем альясам всех смайлов или только по айдишникам
			var smilesIterate = function (callback) {
				$.each(smiles, function (smileID, smileAliases) {
					[].concat(smileAliases).forEach(function (smileAlias) {
						callback.call(this, smileID, smileAlias);
					});
				});
			};
			
			var htmlentitiesencode = function (text) {
				return text
					.replace('"','&#34')
					.replace("'",'&#39')
					.replace('<','&#60')
					.replace('>','&#62');
			};
			
			//вставить в позицию курсора
			var insertAtCursor = function (myField, myValue) {
				myField = $(myField).get(0);
				//IE support
				if (document.selection) {
					myField.focus();
					sel = document.selection.createRange();
					sel.text = myValue;
				}
				//MOZILLA and others
				else if (myField.selectionStart || myField.selectionStart == '0') {
					var startPos = myField.selectionStart;
					var endPos = myField.selectionEnd;
					myField.value = myField.value.substring(0, startPos)
						+ myValue
						+ myField.value.substring(endPos, myField.value.length);
					myField.selectionStart = startPos + myValue.length;
					myField.selectionEnd = startPos + myValue.length;
				} else {
					myField.value += myValue;
				}
			};
			
			//zeroes pad, rough implementation but for us enough
			var pad = function (num, size) {
				var s = "000000000" + num;
				return s.substr(s.length-size);
			};

			var newEl = function (el, plain) {
				el = document.createElement(el);
				if(plain) {
					return el;
				}
				return $(el);
			};
			
			var canSendMessages = function (flag) {
				flag = !!flag;
				sendTextButtonEl.prop('disabled', !flag);
				textToSendEl.prop('disabled', !flag);
				smileSelectButtonEl.toggleClass('disabled', !flag);
				if(!flag) {
					smileContainerEl.hide();
				}
			};
			
			
			
			
			

			return {
				state: function (newState) {
					if(typeof newState != 'undefined' && newState != null) {
						state = newState;
						
						switch(state) {
							case 'connecting':
								connectButtonEL.prop('disabled',true);
								clientIDEl.prop('disabled', true);
								canSendMessages(false);
								ui.logger.clear();
								break;
							case 'connected':
								connectButtonEL
									.prop('disabled',false)
									.text(connectButtonEL.attr('data-disconnecttext'));
								clientIDEl.prop('disabled', true);
								canSendMessages(true);
								textToSendEl.trigger('focus');
								break;
							case 'disconnecting':
								connectButtonEL.prop('disabled',true);
								clientIDEl.prop('disabled', true);
								canSendMessages(false);
								ui.userList.clear();
								break;
							case 'disconnected':
								connectButtonEL
									.prop('disabled',false)
									.text(connectButtonEL.attr('data-connecttext'));
								clientIDEl
									.prop('disabled', false)
									.trigger('focus');
								canSendMessages(false);
								ui.userList.clear();
								break;
						}
					}
						
					return state;
				},
				logger: (function () {
					return {
						add: function (messages) {
							
							if(!(messages instanceof Array)) {
								messages = [messages];
							}
							var messageDate, //дата сообщения
								newLine, //новая строка
								userNameClass = 'logName', //класс спана с именем пользователя
								formedName; //имя пользователя

							//обработка каждого сообщения массива
							messages.forEach(function (message, messageIndex) {
								
								//если сообщение задано не объектом, а строкой
								if(typeof message == 'string') {
									message = { 'message': message };
								}

								//системное сообщение сервера
								if(message['system']) {
									message['message'] = message['system'];
									message['senderName'] = 'Server';
									userNameClass = 'logServerName';
								}

								//время сообщения (локальное  ,если не пришло серверное)
								if(message['time']) {
									messageDate = new Date(message['time']);
								}
								else {
									messageDate = new Date();
								}
								
								//формирование имени автора сообщения
								formedName = false;
								if(message['senderName']) {
									formedName = message['senderName'];
									//индикатор приватности сообщения
									if(message['private']) {
										formedName += ' <span class="logPrivate">(private)</span>';
									}
								}

								//обработка текста сообщения
								message['message'] = message['message']
									.replace(/\n$/, '')
									.replace(/\n/mg, '<br />')
									.replace(/(http(?:s)?:\/\/\S+)/img, '<a href="$1" target="_blank" >$1</a>'); //NOTICE: можно сделать опциональным

								//замена смайлов по альясам на айдишники
								smilesIterate(function (smileID, smileAlias) {
									if(message['message'].split(smileAlias).length > 1) {
										//замена альясов на корректные для html ID в исходном тексте
										message['message'] = message['message'].split(smileAlias).join(smileID+htmlentitiesencode(smileAlias));
									}
								});
								//замена айдишников, которые не могут быть некорректными хмтл символами на итоговые конструкции для смайлов
								smilesIterate(function (smileID, smileAlias) {
									if(message['message'].split(smileID+htmlentitiesencode(smileAlias)).length > 1) {
										message['message'] = message['message'].split(smileID+htmlentitiesencode(smileAlias)).join(
											newEl('div')
												.addClass('clsmile')
												.css('background-image', 'url("img/smiles/'+smileID+'.gif")')
												.attr('data-text', htmlentitiesencode(smileAlias))
												.get(0).outerHTML
										);
									}
								});

								//полная строка сообщения в чате
								newLine = newEl('div')
									.append(
										//время сообщения
										newEl('span')
											.addClass('logTime')
											.html('['+([pad(messageDate.getHours(), 2), pad(messageDate.getMinutes(), 2), pad(messageDate.getSeconds(), 2)].join(":"))+'] '),
										//ник автора сообщения (если был)
										formedName?(newEl('span')
											.addClass(userNameClass)
											.html(formedName+': ')):null,
										//спан текста сообщения
										newEl('span')
											.addClass('logMessage')
											.html(message['message'])
											//обработчики
											//клик по смайлам возвращает их текст
											.find('.clsmile')
												.on('click', function (event) {
													$(this).replaceWith(
														newEl('span')
															.html($(this).attr('data-text'))
													);
												})
											.end()
									);
								chatLogEl
									.stop()
									.append(newLine)
									.animate({ scrollTop: chatLogEl[0].scrollHeight - chatLogEl[0].clientHeight }, 300);
							});
						},
						clear: function () {
							chatLogEl.empty();
						}
					};
				})(),
				//jquery объект меню
				menu: function (data) {
					var menuUL = $(newEl('ul'))
						.addClass('.stmctxmenu');
					data.forEach(function (idx, val) {
						var li = $(newEl('li'))
							.text(data.name)
							.on('click', data.clickEvent || null)
							.appendTo(menuUL);
					});
					
					return menuUL;
				},
				
				userList: (function () {

					var userInList = function (userName) {
						userListEl.children('[data-name="'+userName+'"]').length;
					};
					
					return {
						update: function (userNames, callback) {

							if(!(userNames instanceof Array)) {
								userNames = [userNames];
							}
							var d, newLine;
							//удаляются из ui все клиенты , которых в новом списке нет
							userListEl.children('[data-name]').each(function () {
								if(-1 == $.inArray($(this).attr('[data-name]'), userNames)) {
									$(this).remove();
								}
							});
							//добавляются новые клиенты
							userNames.forEach(function (userName, userIndex) {
								if(!userInList(userName)){
									
									var userLi = newEl('li')
										.addClass('usersName')
										.html(userName)
										.attr({
											'title': userName,
											'data-name': userName
										});
										
									userListEl.append(userLi);

									callback.call(this, userLi);
								}

							});
						},
						clear: function () {
							userListEl.empty();
						}
					};
				})(),
				
				//favicon redraw experiment //TODO: сломан после переделки на фабрики!11
				icon: (function () {

					var icon = false,
						iconr = false,
						iconCanvasCTX = false,
						iconImgObject = false;
					
					$(function () {
						iconImgObject = newEl('img', true);
						iconCanvas = newEl('canvas', true);
						iconCanvas.height = iconCanvas.width = 16;

						if(iconCanvas.getContext) {
							iconCanvasCTX = iconCanvas.getContext('2d');
							iconImgObject.src = 'favicon.png';
							iconImgObject.onload = function () { // once the image has loaded
								redrawIcon(''); //начальная картинка отрисовывается через канвас
							};
						}

					});

					var redrawIcon = function (txt) {
						if(iconCanvasCTX) {

							iconCanvasCTX.clearRect(0,0,iconCanvas.width,iconCanvas.height)
							iconCanvasCTX.drawImage(iconImgObject, 0, 0);
							iconCanvasCTX.font = 'bold 8px "helvetica", sans-serif';
							iconCanvasCTX.fillStyle = '#5555ff';
							
							iconCanvasCTX.fillText('' + txt, 6, 11);
							
							icon=$('#favicon').get(0);
							(iconr = icon.cloneNode(true)).setAttribute('href',iconCanvasCTX.canvas.toDataURL());
							icon.parentNode.replaceChild(iconr,icon);
							//icon.attr('href',iconCanvasCTX.canvas.toDataURL('image/png'));

						}
					};

					return {
						setText: function (txt) {
							console.log('icon setText fired', txt);
							redrawIcon(txt);
						
						}
					};
					
				})(),
				
				window: (function () {
					var myTabOnFront = false;
					var callbacks = {};
					
					var refreshCustomCallbacks = function () {
						for(var cb in callbacks) {
							if(typeof callbacks[cb] == 'function') {
								$(window).off(cb+'.uiwindow').on(cb+'.uiwindow', callbacks[cb]);
							}
							else if(callbacks[cb] == null) {
								$(window).off(cb+'.uiwindow');
							}
						}
					};
					
					//внутренняя инициализация: обработка потери фокуса вкладкой браузера
					$(function () {
						$(window)
							.on('blur', function (event) {
								console.log('window blurred');
								myTabOnFront = false;
							})
							.on('focus', function (event) {
								console.log('window focused');
								myTabOnFront = true;
							});
					});
					
					return {
						focused: function (newFlag) {
							if(typeof newFlag != 'undefined' && newFlag != null) {
								myTabOnFront = !!newFlag;
							}
							return myTabOnFront;
						},
						//чтобы снять - func = null. тут мне многоколбачность не нужна =D
						callbacks: function (type, func) {
							callbacks[type] = func;
							refreshCustomCallbacks();
						}
					};
				})(),

				createMediaWindow: function (id, autoplay, stream) {
					//TODO: определять по типу stream, видео или аудио тэг создавать
					var element = userVideosContainerEl.find('[data-id="' + id + '"]');
					var mediaEl = null;
					var mediaType = false;
					if(element.length) {
						element.remove();
					}
					
					if(!stream.getVideoTracks) {
						stream.getVideoTracks = function () {
							return this.videoTracks;
						};
					}
					
					if(!stream.getAudioTracks) {
						stream.getAudioTracks = function () {
							return this.audioTracks;
						};
					}
					
					//разбор потока на трэки
					if(stream.getVideoTracks().length) {
						mediaType = 'video';
					}
					else if(stream.getAudioTracks().length) {
						mediaType = 'audio';
					}
					
					autoplay = !!autoplay;
					
					if(mediaType) {
						mediaEl = $(newEl(mediaType))
							.addClass('mediaEl')
							.attr('autoplay', autoplay);
						media.attachMediaStream(mediaEl.get(0), stream);
					}

					element = newEl('div')
						.addClass('videoBox')
						.attr('data-id', id)
						.appendTo(userVideosContainerEl)
						.on('mouseover mouseout', function (event) {
							var controls = $(this).find('.controls');
							if(event.type == 'mouseover') {
								controls.removeClass('hidden');
							}
							else if (!controls.find('.block.pause').hasClass('paused')) {
								//скрывать только если видео проигрывается
								controls.addClass('hidden');
							}
						})
						.append(
							$(newEl('div'))
								.addClass('title')
								.html(id),
							mediaEl,
							$(newEl('div'))
								.addClass('controls')
								.addClass(autoplay?'hidden':'')
								.append(
									$(newEl('div'))
										.addClass('block pause')
										.addClass(autoplay?'':'paused')
										.on('click', function (event) {
											var video = $(this)
												.closest('.videoBox')
												.find('.mediaEl')
												.get(0);
											if(!$(this).hasClass('paused')) {
												video.pause();
												$(this).addClass('paused');
											}
											else {
												video.play();
												$(this).removeClass('paused');
											}
										}),
									$(newEl('div'))
										.addClass('block close')
										.on('click', function (event) {
											$(this)
												.closest('.videoBox')
												.remove();
										})
								)
						);

					return element;
				},
				destroyVideoWindow: function (id) {
					userVideosContainerEl.find('[data-id="' + id + '"]').remove();
				},
				//создаёт хтмл интерфейса чата TODO: возможно должен и связывать событиями
				createTextUI: function () {
					webChatInstanceEl = newEl('div')
						.addClass('textChat');

					clientIDEl = newEl('input')
						.attr({
							'type': 'text',
							'placeholder': 'Your name'
						})
						.addClass('clientID');
						
					connectButtonEL = newEl('button')
						.addClass('connectButton')
						.attr({
							'data-disconnecttext': 'Disconnect'
						})
						.text('Connect');
						
					settingsButtonEl = newEl('div')
						.addClass('settingsButton');
						
					chatLogEl = newEl('div')
						.addClass('chatLog');
						
					userListEl = newEl('ul')
						.addClass('users')
						
					smileSelectButtonEl = newEl('div')
						.addClass('smileSelectButton disabled');
						
					textToSendEl = newEl('textarea')
						.addClass('textToSend')
						.attr({
							'placeholder': 'Your message'
						})
						.prop('disabled', true);
						
					sendTextButtonEl = newEl('button')
						.addClass('sendTextButton')
						.prop('disabled', true)
						.text('Send');
						
					smileContainerEl = newEl('div')
						.addClass('smileSelector');
						
					userVideosContainerEl = newEl('div')
						.addClass('userVideos');
						
					webChatInstanceEl
						.append(
							newEl('div')
								.addClass('connectOptions')
								.append(
									clientIDEl,
									connectButtonEL,
									settingsButtonEl
								),
							newEl('div')
								.addClass('messagingOptions')
								.append(
									smileSelectButtonEl,
									textToSendEl,
									sendTextButtonEl,
									smileContainerEl
								),
							chatLogEl,
							userListEl,
							userVideosContainerEl
						);
					
					//связи элементов
					
					//инициализация дива смайлов
					smilesIterate(function (smileID, smileAlias) {
						if(!smileContainerEl.find('.sssmile[data-id="'+smileID+'"]').length) {
							smileContainerEl.append(
								newEl('div')
									.addClass('sssmile')
									.attr('data-id', smileID)
									.css('background-image', 'url(img/smiles/'+smileID+'.gif)')
									.on('click', function (event) {
										insertAtCursor(textToSendEl, '('+smileID+')');
										smileContainerEl.hide();
									})
							);
						}
					});
					
					//привязка открытия диалога к клику по кнопке
					smileSelectButtonEl
						.on('click', function (event) {
							if(!$(this).hasClass('disabled') && !$(this).prop('disabled')) {
								if('none' != smileContainerEl.css('display')) {
									smileContainerEl.hide();
								}
								else {
									smileContainerEl.show();
								}
							}
						});
					
					connectButtonEL
						.attr('data-connecttext', connectButtonEL.text())
						.on('click', function (event) {

							//клик по кнопке соединиться косвенно говорит о том, что наше окно не на бакграунде (нужно для счётчика уведомления о непрочитанных сообщений в фавиконе)
							ui.window.focused(true);

							clientID(clientIDEl.val());

							if(!clientID()) {
								alert('Вы не ввели имя.');
								return;
							}

							config.save('clientID', clientID());

							//соединение
							if(ui.state() == 'disconnected') {
								ui.state('connecting');
								wssClient.connect('wss://'+window.location.host);
							}
							//разъединение
							else if(ui.state() == 'connected') {
								ui.state('disconnecting');
								 wssClient.disconnect();	
							}

						});
					
					clientIDEl.on('keyup', function (event) {
						
						if(event.keyCode == 13) {
							connectButtonEL.trigger('click');
						}
					}); 

					sendTextButtonEl.on('click', function (event) {
						sendMessage(textToSendEl.val());
						textToSendEl
							.val('')
							.trigger('focus');
					});
					
					textToSendEl.on('keydown', function (event) {
						if(event.keyCode == 13) {
							if(!event.ctrlKey) {
								sendTextButtonEl.trigger('click');
								event.preventDefault();
							}
							else {
								textToSendEl.val(function (i, val) {
									return val+"\n"
								});
							}
						}
					});

				},
				textUI: function () {
					return webChatInstanceEl;
				},
				appendTextUI: function (toParentEl) {
					webChatInstanceEl.appendTo(toParentEl);
					ui.state('disconnected');
				},
				setUser: function (userName) {
					clientIDEl.val(userName);
				}
			};
		})();
		
		//событие обновления списка клиентов
		var onClientListUpdate = function (clientNames) {
			//TODO: хэндл случайного дисконнекта клиента: пробегать по всем ртцпирам и искать имена в текущем списке клиентов и если не нашлось - запускать функцию завершения птп соединения с соответствующим клиентом : удалять пирконнекшен, чистить за собой видеоокошки и т.п.

			ui.userList.update(clientNames, function (clientLi) {
				
				clientLi
					.on('click', function (event) {
						var clientName = $(this).attr('data-name');
						if(clientID() == clientName) {
							alert('Loopback chat is disabled.');
						}
						else {
							if(confirm('Create videochat with '+clientName+'?')) {
								mediaCall.startCall(clientName);
							}
						}
					});
			});
		};
		
		//событие добавки сообщения в чат
		var onChatMessage = function (message) {
			//если окна браузера сейчас не видно, в фавиконе появляется счётчик непрочитанных сообщений
			if(!ui.window.focused()) {
				ui.icon.setText(unreadedMessages(unreadedMessages()+1));
			}
			ui.logger.add(message);
		};

		//распределение событий по типам
		var onDataMessage = function (event) {
			incomingData = JSON.parse(event.data);
			
			incomingData.forEach(function (message) {
				//сообщение об ошибке
				if(message['error']) {
					alert(message['error']);
				}
				//обновился список клиентов
				else if(message['clients']) {
					onClientListUpdate(message['clients']);
				}
				else if(message['message'] || message['system']) {
					onChatMessage(message);
				}
			});
		};
		
		//получить или установить количетство непрочитанных сообщений, возможно это чисто ui-шная вещь..
		var unreadedMessages = function (setCount) {
				console.log('unreadedMessages fired', setCount);
				if(typeof setCount != 'undefined' && setCount != null) {
					unreadedMessagesCount = setCount;
				}
				return unreadedMessagesCount;
		};
		
		//сохранение и загрузка локальных настроек в браузере
		var config = (function () {
			var storageCache = {};
			var prefix = '__webchat'+instanceID+'cfgv'+configVersion+'__';
			
			var loadStorage = function () {
				storageCache = JSON.parse(localStorage.getItem(prefix)) || {};
			};
			
			var saveStorage = function () {
				localStorage.setItem(prefix, JSON.stringify(storageCache));
			};
			
			var clearStorage = function () {
				localStorage.setItem(prefix, {});
				window.location.hash = '';
			};
			
			return {
				save: function (name, value) {
					//локал сторадж
					loadStorage();
					storageCache[name] = value;
					saveStorage();
					//хэш с приоритетом
					hash.set(prefix + name, value);
				},
				load: function (name) {
					//из хэша с приоритетом
					var item = hash.get(prefix + name);
					//из локал стораджа, если в хэше нет
					if(item == null) {
						loadStorage();
						item = storageCache[name];
					}
					if(!item) {
						return false;
					}
					return item;
				},
				clear: function () {
					clearStorage();
				},
				//возвращает объект полного конфига
				dump: function () {
					loadStorage();
					return storageCache; 
				},
				restore: function (config, force) {
					var i;
					if(force) {
						clearStorage();
						storageCache = config || {};
					}
					else {
						loadStorage();
						for(i in config) {
							if((typeof storageCache[i] == 'undefined' || null == storageCache[i]) && config[i]) {
								storageCache[i] = config[i];
							}
						}
					}
					
					saveStorage();
				}
			};
		})();
		
		//работа с peerConnection и media для простой организации звонков (использует wssClient, media, ui, callerID())
		var mediaCallManager = function () {

			var instance = (function () {
				var pc_servers = { 
					"iceServers": [
						{"url": "turn:su@213.141.134.4?transport=tcp", "credential": "passwordsu"}
					]
				};
// 				var pc_servers =  {
// 					"iceServers": [
// 						{
// 							"url": "stun:stun.l.google.com:19302"
// 						},
// 						{
// 							'url': "turn:webrtc%40live.com@numb.viagenie.ca",
// 							'credential': 'muazkh'
// 						},
// 						{
// 							'url': 'turn:alykoshin%40gmail.com@numb.viagenie.ca',
// 							'credential': 'hizwep'
// 						},
// 						{
// 							"url": "stun:213.141.134.4"
// 						},
// 						{
// 							"url": "turn:jjj@213.141.134.4",
// 							"credential":"jjj4"
// 						}
// 						{"url": "turn:demo@ec2-184-72-220-242.compute-1.amazonaws.com", "credential": "testing"}
// 					]
// 				};//TODO: задавать этот параметр полем в интерфейсе

				var pc_constraints = {
					"optional": [
						{"RtpDataChannels": true},
						{"DtlsSrtpKeyAgreement": true}
					]
				};
				// Set up audio and video regardless of what devices are present.
				var sdp_constraints = {"optional": [], 'mandatory': {
										'OfferToReceiveAudio':true, 
										'OfferToReceiveVideo':true }};

				var rtcPeerConn = {};
				var rtcEarlyCandidatesFrom = {}; //очередь связанных с ртц сообщений от юзера (если, например, кандидаты пришли раньше оффера , то они будут валиться сюда до создания собственного соединения с этим юзером)
				var onIncomingCallExternalCallback = null;
// 				var onBrokenCallExternalCallback = null;
				
				var RTCPeerConnection = null;
				// RTCPeerConnection
				if (window.webkitRTCPeerConnection) {
				RTCPeerConnection = window.webkitRTCPeerConnection;
				}
				else if (window.mozRTCPeerConnection) {
				RTCPeerConnection = window.mozRTCPeerConnection;
				}
				else if (window.RTCPeerConnection) {
				RTCPeerConnection = window.RTCPeerConnection;
				}

				var RTCSessionDescription = null;
				// RTCSessionDescription
				if (window.webkitRTCSessionDescription) {
				RTCSessionDescription = window.webkitRTCSessionDescription;
				}
				else if (window.mozRTCSessionDescription) {
				RTCSessionDescription = window.mozRTCSessionDescription;
				}
				else if (window.RTCSessionDescription) {
				RTCSessionDescription = window.RTCSessionDescription;
				}
				
				var gotRemoteSessionDescription = function (fromUser, remoteSDP) {
					if(rtcPeerConn[fromUser]) {
						rtcPeerConn[fromUser].setRemoteDescription(new RTCSessionDescription(remoteSDP));
					}
				};
				
				var haveConnection = function (withUser) {
					if(rtcPeerConn[withUser]) {
						return true;
					}
					return false;
				};

				var gotICECandidate = function (fromUser, remoteICECandidate) {
					if(rtcPeerConn[fromUser]) {
						var iceCandidate = new RTCIceCandidate(remoteICECandidate);
						console.log('RTCIceCandidate generated: ', iceCandidate);
						rtcPeerConn[fromUser].addIceCandidate(iceCandidate);
						console.log('RTCIceCandidate added: ', iceCandidate);
					}
				};
				
				var startRTCSession = function (withUser, gotMediaCallback) {

					// get the local stream, show it in the local video element and send it
					media.initialize(function (status, mediaType, stream) {
						if(status != 'success') {
							alert('Can\'t grab video or audio, trying to start without..');
							stream = null;
						}

						if(null != stream) {
							console.log('mediacall got local stream', mediaType, stream);
							
							//NOTICE: не работает т.к. сокрее всего stub
							stream.onended = function (event) {
								console.log('local stream onended fired for window with id', id);
								element.remove();
							};
						}
						
						if(mediaType.video != true) {
							//только аудио
							alert('Can\'t get video, got only audio.');
							ui.createMediaWindow(clientID()+'Audio', false, stream);
						}
						else {
							//аудио и видео
							ui.createMediaWindow(clientID()+'Video', false, stream);
						}
						
						rtcPeerConn[withUser] = new RTCPeerConnection(pc_servers, pc_constraints);

						rtcPeerConn[withUser].gotLocalSessionDescription = function (desc) {
							rtcPeerConn[withUser].setLocalDescription(desc);
							wssClient.send(JSON.stringify({ "to": withUser, "sdp": desc }));
						};
						
						rtcPeerConn[withUser].addStream(stream);
						
						if(typeof gotMediaCallback == 'function') {
							gotMediaCallback.call(this);
						}

						// once remote stream arrives, show it in the remote video element
						rtcPeerConn[withUser].onaddstream = function (event) {
							console.log('mediacall got remote stream', event.stream);

							var streamDispalyElement = ui.createMediaWindow(withUser+'Media', true, event.stream)
								.find('.controls .close')
									.on('click', function (event) {
										rtcPeerConn[withUser].close();
									});

							//NOTICE: не работает т.к. сокрее всего stub
							event.stream.onended = function (event) {
								console.log('remote stream onended fired for window with id', id);
								streamDispalyElement.remove();
							};
							
							//NOTICE: не проверено
							if(null == rtcPeerConn[withUser].onremovestream) {
								rtcPeerConn[withUser].onremovestream = function (event) {
									console.log('got onremovestream event', event);
									streamDispalyElement.remove();
								}
							}
						};

						// send any ice candidates to the server for other peers
						rtcPeerConn[withUser].onicecandidate = function (event) {
							wssClient.send(JSON.stringify({ "to": withUser, "candidate": event.candidate }));
						};
						
						//NOTICE: не работает т.к. сокрее всего stub
						rtcPeerConn[withUser].onstatechange = function (event) {
							console.log('rtcpeer state changed', event);
							//onBrokenCall(withUser);
						};

					});
				};
				
				//внутренняя функция , обрабатывающая приём вызыва
				var onIncomingCall = function (fromUser, remoteSDP) {
					//TODO: здесь должна быть внешняя логика через публичную функцию, позволяющая не отвечать на звонок а сбросить.
					if(typeof onIncomingCallExternalCallback == 'function' && !onIncomingCallExternalCallback.call(this, fromUser)) {
						return false;
					}
					startRTCSession(fromUser, function () {
						rtcPeerConn[fromUser].setRemoteDescription(new RTCSessionDescription(remoteSDP));
						rtcPeerConn[fromUser].createAnswer(rtcPeerConn[fromUser].gotLocalSessionDescription, null, sdp_constraints);
						if(rtcEarlyCandidatesFrom[fromUser]) {
							console.log('processing early ice candidates');
							rtcEarlyCandidatesFrom[fromUser].forEach(function (cnd) {
								gotICECandidate(fromUser, cnd);
							});
						}
					});
				}; 
				
// 				var onBrokenCall = function (withUser) {
// 					//TODO: здесь должна быть внешняя логика через публичную функцию, позволяющая не отвечать на звонок а сбросить.
// 					if(typeof onBrokenCallExternalCallback == 'function' && !onBrokenCallExternalCallback.call(this, withUser)) {
// 						return false;
// 					}
// 					ui.destroyVideoWindow(withUser+'Video');
// 				}; 
				
				//добавляет слушателя звонков при инициализации
				wssClient.addEventListener('webRTCListener', function (status, event) {
					console.log('mediacall got event', event);
					if(typeof event.data == 'undefined') {
						return;
					}
					var incomingData = JSON.parse(event.data);
					
					incomingData.forEach(function (message) {
						if(message['sdp']) {
							console.log('got sdp', message['sdp']);

							//если медиачат ещё не активен с этим юзером
							if (!haveConnection(message['senderName'])) {
								//действия вызванного
								onIncomingCall(message['senderName'], message['sdp']);
							}
							else {
								gotRemoteSessionDescription(message['senderName'], message['sdp']);
							}
						}
						if(message['candidate']) {
							if(!haveConnection(message['senderName'])) {
								if(!rtcEarlyCandidatesFrom[message['senderName']]) {
									rtcEarlyCandidatesFrom[message['senderName']] = [];
								}
								rtcEarlyCandidatesFrom[message['senderName']].push(message['candidate']);
							}
							else {
								gotICECandidate(message['senderName'], message['candidate']);
							}
						}
					});
				});

				return {
					//позвонить используя локальный аудио или видео поток mediaStream (сгенеренный через getUserMedia) или null
					startCall: function (withUser) {
						startRTCSession(withUser, function () {
							rtcPeerConn[withUser].createOffer(rtcPeerConn[withUser].gotLocalSessionDescription, null, sdp_constraints);
						});
					},
					//что делать при поступившем звонке с внешними вещами. если вернуть тут false, звонок будет не принят
					onIncomingCall: function (externalCallback) {
						onIncomingCallExternalCallback = externalCallback;
					}
					,
					endCall: function (withUser) {
						rtcPeerConn[withUser].close();
					}
// 					,
// 					onBrokenCall: function (externalCallback) {
// 						onBrokenCallExternalCallback = externalCallback;
// 					}
				};
			})();
			
			return instance;
		};
		
		//логика
		if(!instanceID) {
			return null;
		}

		wssClient = webSocketClient();

		wssClient.addEventListener('mainListener', function (status, event) {
			console.log('textchat got event', event);
			switch(status) {
				case 'opened':
					//отправляется свой ид (менять ui.state на connected надо только после возвращения от сервера мессаги успешного принятия ника)
					wssClient.send(JSON.stringify({'name': clientID()}));
					break;
					
				case 'closed':
					ui.state('disconnected');
					ui.logger.add('Disconnected from server.');
					break;
					
				case 'error':
					ui.state('disconnected');
					ui.logger.add('Got error from server.');
					break;

				case 'message':
					ui.state('connected');//TODO: сделать это только по мессаге принятия ника сервером
					onDataMessage(event);

					break;
			}
		});

		//добавляет обработчики сообщений через вебсокет, нужные только для медиазвонков
		mediaCall = mediaCallManager();
		
		mediaCall.onIncomingCall(function (withUser) {
			if(confirm(withUser+' wants to establish videochat. Do you agree?')) {
				return true;
			}
			return false;
		});
		
		
		//если при инициализации был передан (начальный..) конфиг, надо применить
		if(instanceConfig) {
			config.restore(JSON.parse(instanceConfig));
		};
		
		//создание себя
		ui.createTextUI();

		//обнуление счётчика непрочитанных сообщений при становлении активным окна браузера //TODO: добавить ид эвента
		ui.window.callbacks('focus', function () {
			ui.icon.setText('');
			unreadedMessages(0);
		});
		
		//загрузка имени пользователя
		if(config.load('clientID')) {
			ui.setUser(config.load('clientID'));
		}
		
		//глобальный обработчик мыши для получения её координат 1 раз.
		$(document).on('mousemove', function (event) {
			mouseX = event.pageX;
			mouseY = event.pageY;
		});

		return {
			//jquery-объект интерфейса чата
			ui: ui.textUI(),
			//выгрузка локальных настроек
			dumpConfig: JSON.stringify(config.dump()),
			//присоединить внутрь нужного элемента
			appendTo: function (parentEl) {
				ui.appendTextUI(parentEl);
			}
		};
	})(webChatInstanceID, webChatInstanceConfig);
	
	return instance;
};
