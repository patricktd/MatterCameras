
export class Logger {
    private static logs: string[] = [];
    private static MAX_LOGS = 1000;

    static log(message: string) {
        // Add to internal log buffer
        this.addEntry(message);
    }

    private static addEntry(entry: string) {
        // Strip ANSI codes for cleaner web display
        const cleanEntry = entry.replace(/\u001b\[[0-9;]*m/g, '');
        this.logs.push(cleanEntry);
        if (this.logs.length > this.MAX_LOGS) {
            this.logs.shift();
        }
    }

    static getLogs(): string[] {
        return [...this.logs];
    }
}

// Hook into process.stdout and process.stderr to capture EVERYTHING
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
    const stringChunk = chunk.toString();
    Logger.log(stringChunk.trim()); // Capture
    return originalStdoutWrite(chunk, encoding, callback); // Pass through
};

process.stderr.write = (chunk: any, encoding?: any, callback?: any) => {
    const stringChunk = chunk.toString();
    Logger.log(stringChunk.trim()); // Capture
    return originalStderrWrite(chunk, encoding, callback); // Pass through
};
