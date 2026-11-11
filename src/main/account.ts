import type { AccountResult, AccountState, SignInProvider } from '../shared/account'

// The account service is not connected yet. This is the one place that changes when it is: the
// interface already asks here for who is signed in, and for sign-in and sign-out.
export async function accountState(): Promise<AccountState> {
  return { connected: false, account: null, plan: null }
}

export async function signIn(_provider: SignInProvider): Promise<AccountResult> {
  return { ok: false, message: 'Sign-in is not connected yet. It arrives with accounts and sync.' }
}

export async function signOut(): Promise<void> {}
