/** Hold motion active for a period after each ONVIF pulse (Scrypted-style debounce). */
export class OnvifMotionDebouncer {
    readonly #holdMs: number;
    readonly #onActive: (active: boolean) => void;
    readonly #onPulse: () => void;
    #holdTimer?: ReturnType<typeof setTimeout>;
    #active = false;

    constructor(holdMs: number, onActive: (active: boolean) => void, onPulse: () => void) {
        this.#holdMs = holdMs;
        this.#onActive = onActive;
        this.#onPulse = onPulse;
    }

    /** Any motion-related ONVIF event extends the hold window. */
    pulse(): void {
        if (!this.#active) {
            this.#active = true;
            this.#onActive(true);
        } else {
            this.#onPulse();
        }
        this.#resetHold();
    }

    stop(): void {
        if (this.#holdTimer) {
            clearTimeout(this.#holdTimer);
            this.#holdTimer = undefined;
        }
        if (this.#active) {
            this.#active = false;
            this.#onActive(false);
        }
    }

    #resetHold(): void {
        if (this.#holdTimer) clearTimeout(this.#holdTimer);
        this.#holdTimer = setTimeout(() => {
            this.#holdTimer = undefined;
            if (this.#active) {
                this.#active = false;
                this.#onActive(false);
            }
        }, this.#holdMs);
    }
}
