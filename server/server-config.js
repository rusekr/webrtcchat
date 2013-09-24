//secure web socket server + http(s) server config; by ST0RM@Teligent

var webSocketsConfig = {
	basicAuth: [
		{
			username: '',
			password: 'god'
		}
	],
	hosts: '*', //звезда или конкретные хосты (массив, если несколько) по запросам на которые будут фильтроваться соединения
	ips: '*', //звезда или конкретные ип (массив, если несколько), на которых будут висеть серверы
	httpPort: 81,
	httpsPort: 443,
	clientTextMessageMaxChars: 20000, //макс длина текстового сообщения от клиента
	clientNameMaxChars: 50, //макс длина имени/id клиента
	clientNamePattern: 'a-z0-9а-яё_.-', //допустимые символы имени/id клиента
	cert: {
		key: '../cert/server.key',
		cert: '../cert/eer.iie.xxx.crt',
		ca: ['../cert/ca.pem', '../cert/sub.class1.server.ca.pem'],
		//откат на неподписанный, если файла key не будет (или если подписан pfx)
		pfx: '../cert/server.pfx'
	},
	contentTypesByExtension: {
		'.html': "text/html",
		'.css':  "text/css",
		'.js':   "text/javascript",
		'.ico':  "image/vnd.microsoft.icon",
		'.png':  "image/png",
		'.gif':  "image/gif"
	}
};

//for nodejs server
if(typeof module !== 'undefined' && module.exports) {
	module.exports.config = webSocketsConfig;
}
