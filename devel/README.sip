Астериск (пропатченный патчем https://github.com/meetecho/asterisk-opus , но это должно быть не обязательным, т.к. для передачи голоса используется только кодек alaw):

Аудио:
Для передачи только аудио все варианты работают, если астериск и клиент настроены по двум докам:
https://wiki.asterisk.org/wiki/display/AST/Asterisk+WebRTC+Support
http://docs.flashphoner.com/display/WCS/WebCallServer+WebRTC+with+Asterisk

Условия функционирования:
1) asterisk: скомпилирован с модулем res_srtp!
2) asterisk: настроен вебсокет сервер:
http.conf:
enabled=yes
bindport=8088
3) asterisk: правила:
extensions.conf:
[stm]
exten => _XXX,1,Dial(SIP/${EXTEN});
4) asterisk клиенты:
sip.conf:
; sip phone client
[201]
type=friend
context=stm 
callerid=sip native 1 <201> 
username=201
secret=12345
host=dynamic
directmedia=no
transport=udp
hasiax = no
hassip = yes
allow=all
qualify=no
canreinvite=no
; webrtc client
[101]
type=friend
context=stm
nat=no
callerid=sip webrtc 1 <101>
username=101
secret=12345
host=dynamic
directmedia=no
transport=ws
avpf=yes
encryption=yes
textsupport=yes
videosupport=yes
dtmfmode=rfc2833
hasiax = no
hassip = yes
icesupport = yes
disallow=all
allow=alaw
realm=asterisk
qualify=no
canreinvite=no

Видео:
1) С видео между линфоном и браузером проблемы из-за кодека vp8

2) Если звонить с браузера на браузер с видео:
WARNING[3488][C-00000007]: chan_sip.c:10423 process_sdp: Rejecting secure video stream without encryption details: video 52096 RTP/SAVPF 100 116 117