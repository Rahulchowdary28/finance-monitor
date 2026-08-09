// sw.js - Virtual Vault Advanced Web Push Receiver

self.addEventListener('push', (event) => {
    let data = { 
        title: 'Vault System Notice', 
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
        tag: data.tag || 'vault-notification',
        renotify: true,
        data: { 
            url: data.url || '/' 
        },
        // Interactive Action Buttons
        actions: [
            {
                action: 'open_app',
                title: '👁️ Open Vault'
            },
            {
                action: 'dismiss',
                title: '✖️ Dismiss'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Virtual Vault', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    // 1. Close the notification banner immediately
    event.notification.close();

    // 2. Handle "Dismiss" Action
    if (event.action === 'dismiss') {
        return;
    }

    // 3. Resolve target URL relative to origin
    const rawUrl = event.notification.data?.url || '/';
    const targetUrl = new URL(rawUrl, self.location.origin).href;

    // 4. Safely focus or open target window
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
            // Check if app tab is already open
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin)) {
                    // Safely attempt navigation if URL differs, then bring to front
                    if ('navigate' in client && client.url !== targetUrl) {
                        try {
                            await client.navigate(targetUrl);
                        } catch (err) {
                            console.warn('Navigation failed, focusing existing window:', err);
                        }
                    }
                    if ('focus' in client) {
                        return client.focus();
                    }
                }
            }

            // Fallback: Open new browser window if tab isn't open
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// Immediately activate new service worker versions
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});
