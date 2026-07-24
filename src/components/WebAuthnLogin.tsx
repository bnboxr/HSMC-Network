/**
 * WebAuthnLogin — Biometric Login Component
 *
 * Flow:
 * 1. User clicks "🔐 Login with Biometric"
 * 2. Browser requests fingerprint/face via WebAuthn API
 * 3. Signed assertion is sent to server for verification
 * 4. On success, receives JWT and redirects to dashboard
 *
 * Falls back gracefully if WebAuthn is not supported.
 */
import { useState, useEffect } from 'react';
import { Fingerprint, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

const API_BASE = '';

interface WebAuthnLoginProps {
  onSuccess: (token: string, user: { id: string; email: string }) => void;
  className?: string;
}

const WebAuthnLogin = ({ onSuccess, className }: WebAuthnLoginProps) => {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const available = !!(
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential === 'function' &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    );

    if (available) {
      // Check for platform authenticator (fingerprint, face, etc.)
      Promise.all([
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
        Promise.resolve(true),
      ])
        .then(([uvpaa]) => {
          setSupported(uvpaa);
        })
        .catch(() => {
          setSupported(false);
        });
    } else {
      setSupported(false);
    }
  }, []);

  const getChallenge = async (): Promise<string> => {
    const res = await fetch(`${API_BASE}/auth/webauthn/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'login' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to get challenge' }));
      throw new Error(err.error || 'Failed to get challenge');
    }
    const data = await res.json();
    return data.challenge;
  };

  const handleLogin = async () => {
    if (!supported) {
      setError('Biometric login is not available on this device.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Get challenge
      const challenge = await getChallenge();

      // 2. Get assertion via WebAuthn API
      const challengeBytes = Uint8Array.from(
        atob(challenge.replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );

      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge: challengeBytes,
        rpId: window.location.hostname,
        userVerification: 'preferred',
        timeout: 60000,
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error('Authentication returned null — was it cancelled?');
      }

      const response = assertion.response as AuthenticatorAssertionResponse;

      // 3. Send to server for verification
      const loginRes = await fetch(`${API_BASE}/auth/webauthn/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: assertion.id,
            rawId: bufferToBase64url(new Uint8Array(assertion.rawId as ArrayBuffer)),
            response: {
              authenticatorData: bufferToBase64url(new Uint8Array(response.authenticatorData)),
              clientDataJSON: bufferToBase64url(new Uint8Array(response.clientDataJSON)),
              signature: bufferToBase64url(new Uint8Array(response.signature)),
              userHandle: response.userHandle
                ? bufferToBase64url(new Uint8Array(response.userHandle))
                : undefined,
            },
            type: assertion.type,
          },
        }),
      });

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        const msg = errData.error || `Login failed (${loginRes.status})`;
        if (loginRes.status === 404) {
          throw new Error('No biometric credential found. Please register first.');
        }
        throw new Error(msg);
      }

      const data = await loginRes.json();
      toast({ title: '✅ Biometric Login Successful', description: `Welcome back, ${data.user?.email || 'user'}!` });
      onSuccess(data.token, data.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast({ title: 'Biometric Login Failed', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Don't show if support hasn't been determined
  if (supported === null) {
    return (
      <div className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${className || ''}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking biometric support...
      </div>
    );
  }

  // Don't show if not supported
  if (!supported) {
    return null;
  }

  return (
    <div className={className || ''}>
      {error && (
        <div className="flex items-start gap-2 p-3 mb-3 bg-destructive/5 border border-destructive/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <Button
        onClick={handleLogin}
        disabled={loading}
        variant="outline"
        className="w-full gap-2"
        size="lg"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Fingerprint className="w-4 h-4" />
        )}
        Login with Biometric
      </Button>

      <p className="text-[10px] text-muted-foreground/60 text-center mt-2">
        Use your fingerprint, face, or device PIN to log in securely.
        Your biometric data never leaves this device.
      </p>
    </div>
  );
};

function bufferToBase64url(buffer: Uint8Array): string {
  const binary = String.fromCharCode(...buffer);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default WebAuthnLogin;
