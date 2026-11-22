import { inject, type InjectionKey } from 'vue';
import type { AuthClient, Session } from '../auth/session';

export const AUTH_CLIENT: InjectionKey<AuthClient> = Symbol('auth-client');
export const AUTH_SESSION: InjectionKey<Session> = Symbol('auth-session');

export const useSession = (): Session | null => inject(AUTH_SESSION, null);
export const useAuth = (): AuthClient | null => inject(AUTH_CLIENT, null);
