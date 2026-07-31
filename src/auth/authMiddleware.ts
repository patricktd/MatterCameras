import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session?.userId) {
        next();
        return;
    }
    res.redirect('/login');
}

export function requirePasswordChange(req: Request, res: Response, next: NextFunction): void {
    if (req.session?.mustChangePassword) {
        res.redirect('/change-password');
        return;
    }
    next();
}
