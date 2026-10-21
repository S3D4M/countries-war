# Relay TikTok المستخدم للإصلاح

- EulerStream WebSocket docs: https://www.eulerstream.com/docs/api/websockets
- TikTok WebSocket API: https://www.eulerstream.com/docs/api/tiktok-web-socket-api
- SDK: https://github.com/EulerStream/Euler-WebSocket-SDK

المعلومة الأساسية: اتصال الإنتاج يكون عبر `wss://ws.eulerstream.com` مع `uniqueId` و`apiKey`، ويفضل `features.bundleEvents=true` و`features.syntheticPresence=true`. الأكواد 4404 تعني أن الحساب غير مباشر، 4005 نهاية البث، 4500 انقطاع TikTok، و4006 عدم وجود رسائل. SDK الرسمي `@eulerstream/euler-websocket-sdk` يوفّر `createWebSocketUrl` و`WebcastEventEmitter` لفك رسائل Relay.
