/**
 * WebAuthnSetup — Biometric Login Setup Component
 *
 * Flow:
 * 1. User clicks "Enable Biometric Login"
 * 2. Browser requests fingerprint/face/PIN via WebAuthn API
 * 3. Credential (public key only) is sent to server
 * 4. Server stores public key; private key stays in device's secure enclave
 * 5. Shows "✅ Biometric Login Enabled" with disable option
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Fingerprint, Shield, Loader2, CheckCircle2, XCircle, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

const API_BASE = '';

interface WebAuthnSetupProps {
  userId: string;
}

interface StoredCredential {
  id: string;
  device_name: string;
  created_at: string;
  last_used_at: string | null;
}

const WebAuthnSetup = ({ userId }: WebAuthnSetupProps) => {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check WebAuthn support
  useEffect(() => {
    const available = !!(
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential === 'function'
    );
    setSupported(available);
  }, []);

  // Fetch existing credentials
  useEffect(() => {
    if (!userId) return;
    const fetchCreds = async () => {
      setFetching(true);
      try {
        const res = await fetch(
          `${API_BASE}/rest/v1/webauthn_credentials?select=*&user_id=eq.${encodeURIComponent(userId)}`
        );
        if (res.ok) {
          const data = await res.json();
          setCredentials(Array.isArray(data) ? data : []);
        }
      } catch {
        // Silently fail — user can still try to register
      } finally {
        setFetching(false);
      }
    };
    fetchCreds();
  }, [userId]);

  const getChallenge = async (): Promise<string> => {
    const res = await fetch(`${API_BASE}/auth/webauthn/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to get challenge' }));
      throw new Error(err.error || 'Failed to get challenge');
    }
    const data = await res.json();
    return data.challenge;
  };

  const handleEnable = async () => {
    if (!supported) {
      toast({ title: 'Not Supported', description: 'WebAuthn is not available in this browser.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Get challenge from server
      const challenge = await getChallenge();

      // 2. Create credential via WebAuthn API
      const challengeBytes = Uint8Array.from(
        atob(challenge.replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );

      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: challengeBytes,
        rp: {
          name: 'HSMC Network',
          id: window.location.hostname,
        },
        user: {
          id: Uint8Array.from(userId, c => c.charCodeAt(0)),
          name: userId,
          displayName: `HSMC User (${userId.slice(0, 8)})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Credential creation returned null');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Detect device name
      const deviceName = detectDevice();

      // 3. Send to server
      const registerRes = await fetch(`${API_BASE}/auth/webauthn/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: bufferToBase64url(new Uint8Array(credential.rawId as ArrayBuffer)),
            response: {
              attestationObject: bufferToBase64url(new Uint8Array(response.attestationObject)),
              clientDataJSON: bufferToBase64url(new Uint8Array(response.clientDataJSON)),
            },
            type: credential.type,
          },
          userId,
          deviceName,
        }),
      });

      if (!registerRes.ok) {
        const errData = await registerRes.json().catch(() => ({}));
        throw new Error(errData.error || `Registration failed (${registerRes.status})`);
      }

      toast({ title: '✅ Biometric Login Enabled', description: `Device: ${deviceName}` });

      // Refresh credentials list
      const credsRes = await fetch(
        `${API_BASE}/rest/v1/webauthn_credentials?select=*&user_id=eq.${encodeURIComponent(userId)}`
      );
      if (credsRes.ok) {
        const data = await credsRes.json();
        setCredentials(Array.isArray(data) ? data : []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast({ title: 'Setup Failed', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (credentialId?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/webauthn/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          credentialId: credentialId || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to disable');
      }

      toast({ title: '🗑️ Biometric Login Disabled' });

      // Refresh
      if (credentialId) {
        setCredentials(prev => prev.filter(c => c.id !== credentialId));
      } else {
        setCredentials([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (supported === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking device compatibility...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel p-6 rounded-xl space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
          <Fingerprint className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Biometric Login</h3>
          <p className="text-xs text-muted-foreground">
            {supported
              ? 'Use fingerprint, face, or PIN to log in instantly'
              : '❌ Your browser does not support WebAuthn biometric authentication'}
          </p>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Existing credentials */}
      {fetching ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading credentials...
        </div>
      ) : credentials.length > 0 ? (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <div
              key={cred.id}
              className="flex items-center justify-between p-3 bg-card/50 border border-border/40 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{cred.device_name || 'Unknown Device'}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Registered: {new Date(cred.created_at).toLocaleDateString()}
                    {cred.last_used_at && ` · Last used: ${new Date(cred.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisable(cred.id)}
                disabled={loading}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          No biometric credentials configured yet.
        </div>
      )}

      {/* Action button */}
      {supported && (
        <Button
          onClick={handleEnable}
          disabled={loading}
          className="w-full gap-2"
          variant={credentials.length > 0 ? 'outline' : 'default'}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Fingerprint className="w-4 h-4" />
          )}
          {credentials.length > 0 ? 'Add Another Device' : 'Enable Biometric Login'}
        </Button>
      )}

      {/* Security note */}
      <p className="text-[10px] text-muted-foreground/60 text-center">
        Your biometric data never leaves this device. Only a public key is stored on our server.
        The private key stays in your device's secure enclave (Secure Enclave / TPM).
      </p>
    </motion.div>
  );
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer: Uint8Array): string {
  const binary = String.fromCharCode(...buffer);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua) && 'ontouchstart' in window) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android Device';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Linux/.test(ua)) return 'Linux Device';
  return 'Unknown Device';
}

export default WebAuthnSetup;
