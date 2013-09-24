var coolPhone = null;

var attachMediaStream = null;

// getUserMedia
if (window.navigator.webkitGetUserMedia) {

	attachMediaStream = function(element, stream) {
		element.src = webkitURL.createObjectURL(stream);
	};
}
else if (window.navigator.mozGetUserMedia) {

	attachMediaStream = function(element, stream) {
		element.mozSrcObject = stream;
	};
}
else if (window.navigator.getUserMedia) {

	attachMediaStream = function(element, stream) {
		element.src = stream;
	};
}

$(function () {

	// HTML5 <video> elements in which local and remote video will be shown
	var selfView =   document.getElementById('my-video');
	var remoteView =  document.getElementById('peer-video');
	
	$('.draggable').draggable();

	$('#sipconnect').on('click', function (event) {
		if(coolPhone) {
			coolPhone.stop();
		}

		coolPhone = new JsSIP.UA({
			'ws_servers': 'ws://'+$('#sipuri').val().replace(/^.*?@/, '')+':8088/ws',
			'uri': $('#sipuri').val(),
			'password': $('#sippasswd').val(),
			'stun_servers': [],
			'trace_sip': true,
			'register': true,
			'use_preloaded_route': true
			//,hack_via_tcp: true
		});
		
		
		coolPhone.on('connected', function(e){ 
			console.log('sip connected', e);
			
		});

		coolPhone.on('disconnected', function(e){ 
			console.log('sip disconnected', e);
			
		});
		coolPhone.on('registered', function(e){ 
			console.log('sip registered', e); 
			
		});
		coolPhone.on('unregistered', function(e){ 
			console.log('sip unregistered', e); 
			
		});
		coolPhone.on('registrationFailed', function(e){ 
			console.log('sip can\'t register', e); 
			
		});
		
		//got sip call
		coolPhone.on('newRTCSession', function(e){ 
			console.log('sip new rtc session created', e); 
			
			
			if(e.data.originator == 'remote') {
				var rtcSession = e.data.session;
				console.log('sip received call');
				
			// Attach local stream to selfView
			if (rtcSession.getLocalStreams().length > 0) {
				attachMediaStream(selfView, rtcSession.getLocalStreams()[0]);
				console.log('attached local media stream');
			}

			// Attach remote stream to remoteView
			if (rtcSession.getRemoteStreams().length > 0) {
				attachMediaStream(remoteView, rtcSession.getRemoteStreams()[0]);
				console.log('attached remote media stream');
			}
			
			console.log('sip call invoking answer');
				rtcSession.answer(selfView, remoteView);
			}
			

			
		});
		
		coolPhone.start();
		
		return false;
	});
	
	$('#sipcall').on('click', function (event) {
		
		// Register callbacks to desired call events
		var eventHandlers = {
		'progress':   function(e){ console.log('sip call in progress'); },
		'failed':     function(e){ console.log('sip call failed'); },
		'started':    function(e){
			console.log('sip call started');
			var rtcSession = e.sender;

			// Attach local stream to selfView
			if (rtcSession.getLocalStreams().length > 0) {
				attachMediaStream(selfView, rtcSession.getLocalStreams()[0]);
				console.log('attached local media stream');
			}

			// Attach remote stream to remoteView
			if (rtcSession.getRemoteStreams().length > 0) {
				attachMediaStream(remoteView, rtcSession.getRemoteStreams()[0]);
				console.log('attached remote media stream');
			}
		},
		'ended':      function(e){ console.log('sip call ended'); }
		};

		var options = {
		'eventHandlers': eventHandlers,
		'extraHeaders': [ 'X-Foo: foo', 'X-Bar: bar' ],
		'mediaConstraints': /*{'audio': false, 'video': true }*/{'audio': true, 'video': $('#videoenabled').prop('checked') }
		};
		
		//alert($('#videoenabled').prop('checked'));

		coolPhone.call($('#sipcallto').val(), options);
	});
	
	
	$('#sipuri, #sippasswd, #sipcallto')
		.on('change', function (event) {
			hash.set('wrtcsip-'+this.id, $(this).val());
		})
		.each(function (i, obj) {
			if(hash.get('wrtcsip-'+obj.id)) {
				$('#'+obj.id).val(hash.get('wrtcsip-'+obj.id));
			}
		});

});
