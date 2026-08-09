// sw.js - Virtual Vault Mobile Push Receiver

self.addEventListener('push', (event) => {
    let data = { 
        title: 'Virtual Vault', 
        message: 'New transaction update available!',
        url: '/'
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.message = event.data.text();
        }
    }

    const options = {
        body: data.message || data.body || 'System update received.',
        icon: data.icon || 'https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png',
        badge: data.badge || 'https://cdn-icons-png.flaticon.com/512/584/584026.png',
        vibrate: [100, 50, 100],
        tag: 'vault-notification',
        renotify: true,
        data: { 
            url: data.url || '/' 
        },
        actions: [
            { action: 'open_app', title: '👁️ Open Vault' },
            { action: 'dismiss', title: '✖️ Dismiss' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Virtual Vault', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // 1. If user tapped "Dismiss", exit immediately
    if (event.action === 'dismiss') {
        return;
    }

    // 2. Build full target URL
    const relativeUrl = event.notification.data?.url || '/';
    const targetUrl = new URL(relativeUrl, self.location.origin).href;

    // 3. Directly handle focus or open tab
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If any window/tab of this origin is open, focus it
                for (let i = 0; i < clientList.length; i++) {
                    let client = clientList[i];
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If no tab is open, launch a new window
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
    );
});

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});
