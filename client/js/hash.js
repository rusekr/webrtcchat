//by ST0RM
//работает с переменными хэша, считая = присвоением и | разделителем (полностью независимый объект)
var hash = hash || (function () {
	var hashData = {};
	
	var dec = function (str) {
		return str.replace('&#61;', '=').replace('&#124;', '|');
	};
	var enc = function (str) {
		return str.replace('=', '&#61;').replace('|', '&#124;');
	};
	
	var parseHash = function () {
		var h = window.location.hash.replace(/^#/, '').split('|');
		var tmpData = {};
		h.forEach(function (data) {
			data = data.split('=');
			if(data[0] && data[1]) {
				tmpData[dec(data[0])] = dec(data[1]);
			}
		});
		hashData = tmpData;
	};
	var buildHash = function () {
		var tmpHash = [];
		for(id in hashData) {
			tmpHash.push(enc(id)+'='+enc(hashData[id]));
		}
		return (tmpHash.length)?'#'+tmpHash.join('|'):'';
	};
	
	return {
		get: function (id) {
			parseHash();
			return (typeof hashData[id] != 'undefined')?hashData[id]:null;
		},
		set: function (id, value) {
			parseHash();
			hashData[id] = value;
			window.location.hash = buildHash();
		}
	};
})();
