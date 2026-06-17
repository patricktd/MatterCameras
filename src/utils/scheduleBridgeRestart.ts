/** Exit so Docker restarts the app with cameras loaded before Matter networking (hub partsList). */
export function scheduleBridgeRestart(reason: string, delayMs = 1500) {
    console.log(`Scheduling bridge restart: ${reason}`);
    setTimeout(() => {
        console.log('Restarting to refresh Matter partsList for SmartThings hub...');
        process.exit(0);
    }, delayMs);
}
