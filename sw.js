// sw.js - Virtual Vault Web Push Receiver

self.addEventListener('push', (event) => {
    let data = { title: 'Vault System Notice', message: 'New transaction update available!' };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.message = event.data.text();
        }
    }

    const options = {
        // Fallback checks both 'body' and 'message' to match your broadcast payload
        body: data.message || data.body || 'System update received.',
        icon: data.icon || 'https://cdn-icons-png.flaticon.com/512/584/584026.png',
        badge: data.badge || 'https://cdn-icons-png.flaticon.com/512/584/584026.png',
        vibrate: [100, 50, 100],
        data: { 
            url: data.url || '/' 
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Virtual Vault', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Re-focus existing open tab if available
            for (let client of windowClients) {
                if (client.url.includes(targetUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
