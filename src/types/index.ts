export interface Camera {
    id: string;
    name: string;
    rtspUrl: string;
    codec?: string; // e.g. 'h264'
    // internal settings
    onvifUrl?: string;
    username?: string;
    password?: string;
}

export interface PairingInfo {
    qrCode: string;
    manualPairingCode: string;
}
