import '@testing-library/jest-dom';

// Polyfills
if (typeof window !== 'undefined') {
    // Mock chrome extension API
    global.chrome = {
        runtime: {
            sendMessage: jest.fn(),
            getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`),
            onMessage: {
                addListener: jest.fn(),
                removeListener: jest.fn(),
            },
        },
        storage: {
            local: {
                get: jest.fn(),
                set: jest.fn(),
            }
        },
        tabs: {
            create: jest.fn(),
        }
    };

    global.URL.createObjectURL = jest.fn(() => 'mock-url');
    global.URL.revokeObjectURL = jest.fn();
}
