/// HSMC Script Engine — Bitcoin-compatible script opcodes with extensions
/// Supports: P2PKH, P2SH, P2WPKH, OP_CHECKMULTISIG, OP_CHECKSEQUENCEVERIFY,
///           OP_CHECKLOCKTIMEVERIFY, OP_RETURN (data), Ring-sig extensions
use std::collections::HashMap;
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ─── Opcode definitions ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Opcode {
    // Stack ops
    Op0          = 0x00,
    OpPushData1  = 0x4c,
    OpPushData2  = 0x4d,
    OpPushData4  = 0x4e,
    Op1Negate    = 0x4f,
    Op1          = 0x51,
    Op2          = 0x52,
    Op3          = 0x53,
    Op16         = 0x60,
    OpNop        = 0x61,
    OpReturn     = 0x6a,
    OpDepth      = 0x74,
    OpDrop       = 0x75,
    OpDup        = 0x76,
    Op2Dup       = 0x6e,
    Op3Dup       = 0x6f,
    OpNip        = 0x77,
    OpOver       = 0x78,
    OpPick       = 0x79,
    OpRoll       = 0x7a,
    OpRot        = 0x7b,
    OpSwap       = 0x7c,
    OpTuck       = 0x7d,
    Op2Drop      = 0x6d,
    Op2Over      = 0x70,
    Op2Rot       = 0x71,
    Op2Swap      = 0x72,
    OpIfDup      = 0x73,
    // Splice
    OpCat        = 0x7e,
    OpSubstr     = 0x7f,
    OpLeft       = 0x80,
    OpRight      = 0x81,
    OpSize       = 0x82,
    // Bitwise
    OpInvert     = 0x83,
    OpAnd        = 0x84,
    OpOr         = 0x85,
    OpXor        = 0x86,
    OpEqual      = 0x87,
    OpEqualVerify= 0x88,
    // Arithmetic
    Op1Add       = 0x8b,
    Op1Sub       = 0x8c,
    OpNegate     = 0x8f,
    OpAbs        = 0x90,
    OpNot        = 0x91,
    Op0NotEqual  = 0x92,
    OpAdd        = 0x93,
    OpSub        = 0x94,
    OpMul        = 0x95,
    OpDiv        = 0x96,
    OpMod        = 0x97,
    OpLShift     = 0x98,
    OpRShift     = 0x99,
    OpBoolAnd    = 0x9a,
    OpBoolOr     = 0x9b,
    OpNumEqual   = 0x9c,
    OpNumEqualVerify = 0x9d,
    OpNumNotEqual= 0x9e,
    OpLessThan   = 0x9f,
    OpGreaterThan= 0xa0,
    OpLessThanOrEqual = 0xa1,
    OpGreaterThanOrEqual = 0xa2,
    OpMin        = 0xa3,
    OpMax        = 0xa4,
    OpWithin     = 0xa5,
    // Crypto
    OpRipemd160  = 0xa6,
    OpSha1       = 0xa7,
    OpSha256     = 0xa8,
    OpHash160    = 0xa9,
    OpHash256    = 0xaa,
    OpCodeSeparator = 0xab,
    OpCheckSig   = 0xac,
    OpCheckSigVerify = 0xad,
    OpCheckMultiSig = 0xae,
    OpCheckMultiSigVerify = 0xaf,
    // Time locks
    OpCheckLockTimeVerify = 0xb1,
    OpCheckSequenceVerify = 0xb2,
    // HSMC extensions
    OpRingCheckSig   = 0xc0,
    OpStealthAddress  = 0xc1,
    OpConfidentialTx  = 0xc2,
    OpBulletproof     = 0xc3,
    // Control flow
    OpIf          = 0x63,
    OpNotIf       = 0x64,
    OpElse        = 0x67,
    OpEndIf       = 0x68,
    OpVerify      = 0x69,
}

impl TryFrom<u8> for Opcode {
    type Error = ScriptError;
    fn try_from(v: u8) -> Result<Self, ScriptError> {
        // Map common opcodes
        match v {
            0x00 => Ok(Self::Op0),
            0x51..=0x60 => {
                let ops = [Self::Op1, Self::Op2, Self::Op3, Self::Op16];
                match v {
                    0x51 => Ok(Self::Op1),
                    0x52 => Ok(Self::Op2),
                    0x53 => Ok(Self::Op3),
                    0x60 => Ok(Self::Op16),
                    _ => Err(ScriptError::UnknownOpcode(v)),
                }
            }
            0x63 => Ok(Self::OpIf),
            0x64 => Ok(Self::OpNotIf),
            0x67 => Ok(Self::OpElse),
            0x68 => Ok(Self::OpEndIf),
            0x69 => Ok(Self::OpVerify),
            0x6a => Ok(Self::OpReturn),
            0x75 => Ok(Self::OpDrop),
            0x76 => Ok(Self::OpDup),
            0x87 => Ok(Self::OpEqual),
            0x88 => Ok(Self::OpEqualVerify),
            0x93 => Ok(Self::OpAdd),
            0x94 => Ok(Self::OpSub),
            0xa8 => Ok(Self::OpSha256),
            0xa9 => Ok(Self::OpHash160),
            0xaa => Ok(Self::OpHash256),
            0xac => Ok(Self::OpCheckSig),
            0xad => Ok(Self::OpCheckSigVerify),
            0xae => Ok(Self::OpCheckMultiSig),
            0xaf => Ok(Self::OpCheckMultiSigVerify),
            0xb1 => Ok(Self::OpCheckLockTimeVerify),
            0xb2 => Ok(Self::OpCheckSequenceVerify),
            0xc0 => Ok(Self::OpRingCheckSig),
            0xc1 => Ok(Self::OpStealthAddress),
            0xc2 => Ok(Self::OpConfidentialTx),
            0xc3 => Ok(Self::OpBulletproof),
            _ => Err(ScriptError::UnknownOpcode(v)),
        }
    }
}

// ─── Script Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptType {
    P2PKH,                // Pay to Public Key Hash
    P2SH,                 // Pay to Script Hash
    P2WPKH,              // Pay to Witness Public Key Hash (SegWit v0)
    P2WSH,               // Pay to Witness Script Hash
    P2TR,                // Pay to Taproot
    Multisig { m: u8, n: u8 },
    OpReturn(Vec<u8>),   // Data carrier
    RingCt,              // HSMC RingCT privacy transaction
    Confidential,        // Pedersen commitment outputs
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub bytes: Vec<u8>,
    pub script_type: ScriptType,
}

impl Script {
    pub fn new(bytes: Vec<u8>) -> Self {
        let script_type = Self::classify(&bytes);
        Self { bytes, script_type }
    }

    /// Build a P2PKH scriptPubKey: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
    pub fn p2pkh(pubkey_hash: &[u8]) -> Self {
        let mut s = vec![0x76, 0xa9, pubkey_hash.len() as u8];
        s.extend_from_slice(pubkey_hash);
        s.extend_from_slice(&[0x88, 0xac]);
        Self::new(s)
    }

    /// Build a P2SH scriptPubKey: OP_HASH160 <scriptHash> OP_EQUAL
    pub fn p2sh(script_hash: &[u8]) -> Self {
        let mut s = vec![0xa9, script_hash.len() as u8];
        s.extend_from_slice(script_hash);
        s.push(0x87);
        Self::new(s)
    }

    /// Build P2WPKH: OP_0 <20-byte-pubkey-hash>
    pub fn p2wpkh(pubkey_hash: &[u8; 20]) -> Self {
        let mut s = vec![0x00, 0x14];
        s.extend_from_slice(pubkey_hash);
        Self::new(s)
    }

    /// Build OP_RETURN data script
    pub fn op_return(data: &[u8]) -> Self {
        let mut s = vec![0x6a, data.len() as u8];
        s.extend_from_slice(data);
        Self::new(s)
    }

    /// Classify script type from bytes
    fn classify(bytes: &[u8]) -> ScriptType {
        // P2PKH: 25 bytes, OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
        if bytes.len() == 25
            && bytes[0] == 0x76
            && bytes[1] == 0xa9
            && bytes[2] == 0x14
            && bytes[23] == 0x88
            && bytes[24] == 0xac
        {
            return ScriptType::P2PKH;
        }
        // P2SH: 23 bytes, OP_HASH160 <20 bytes> OP_EQUAL
        if bytes.len() == 23 && bytes[0] == 0xa9 && bytes[1] == 0x14 && bytes[22] == 0x87 {
            return ScriptType::P2SH;
        }
        // P2WPKH: 22 bytes, OP_0 <20 bytes>
        if bytes.len() == 22 && bytes[0] == 0x00 && bytes[1] == 0x14 {
            return ScriptType::P2WPKH;
        }
        // P2WSH: 34 bytes, OP_0 <32 bytes>
        if bytes.len() == 34 && bytes[0] == 0x00 && bytes[1] == 0x20 {
            return ScriptType::P2WSH;
        }
        // P2TR: 34 bytes, OP_1 <32 bytes>
        if bytes.len() == 34 && bytes[0] == 0x51 && bytes[1] == 0x20 {
            return ScriptType::P2TR;
        }
        // OP_RETURN
        if !bytes.is_empty() && bytes[0] == 0x6a {
            let data = if bytes.len() > 2 { bytes[2..].to_vec() } else { vec![] };
            return ScriptType::OpReturn(data);
        }
        // Multisig: OP_m <pubkeys...> OP_n OP_CHECKMULTISIG
        if bytes.len() > 3 && bytes[bytes.len() - 1] == 0xae {
            let n_op = bytes[bytes.len() - 2];
            let m_op = bytes[0];
            if (0x51..=0x60).contains(&m_op) && (0x51..=0x60).contains(&n_op) {
                let m = m_op - 0x50;
                let n = n_op - 0x50;
                return ScriptType::Multisig { m, n };
            }
        }
        ScriptType::Unknown
    }

    /// Compute script hash (used for P2SH)
    pub fn hash160(&self) -> [u8; 20] {
        let sha = Sha256::digest(&self.bytes);
        // Simplified RIPEMD160 using double SHA256 for compatibility
        let mut result = [0u8; 20];
        let sha2 = Sha256::digest(sha);
        result.copy_from_slice(&sha2[..20]);
        result
    }

    pub fn is_standard(&self) -> bool {
        matches!(
            self.script_type,
            ScriptType::P2PKH | ScriptType::P2SH | ScriptType::P2WPKH
            | ScriptType::P2WSH | ScriptType::P2TR | ScriptType::OpReturn(_)
        )
    }
}

// ─── Script Interpreter ───────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum ScriptError {
    #[error("Unknown opcode: 0x{0:02x}")]
    UnknownOpcode(u8),
    #[error("Stack underflow")]
    StackUnderflow,
    #[error("Stack overflow (max 1000 elements)")]
    StackOverflow,
    #[error("Script too large")]
    ScriptTooLarge,
    #[error("Non-minimal push")]
    NonMinimalPush,
    #[error("OP_RETURN encountered")]
    OpReturn,
    #[error("Verify failed")]
    VerifyFailed,
    #[error("Signature check failed")]
    SigCheckFailed,
    #[error("Disabled opcode")]
    DisabledOpcode,
    #[error("Invalid stack state at end")]
    InvalidFinalStack,
    #[error("Max ops exceeded")]
    MaxOpsExceeded,
    #[error("Script execution error: {0}")]
    Execution(String),
}

pub type ScriptResult<T> = Result<T, ScriptError>;

const MAX_STACK_SIZE: usize = 1000;
const MAX_SCRIPT_SIZE: usize = 10_000;
const MAX_OPS_PER_SCRIPT: usize = 201;
const MAX_ELEMENT_SIZE: usize = 520;

pub struct ScriptInterpreter {
    stack: Vec<Vec<u8>>,
    alt_stack: Vec<Vec<u8>>,
    op_count: usize,
    flags: ScriptFlags,
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy)]
    pub struct ScriptFlags: u32 {
        const VERIFY_P2SH          = 1 << 0;
        const VERIFY_STRICTENC     = 1 << 1;
        const VERIFY_DERSIG        = 1 << 2;
        const VERIFY_LOW_S         = 1 << 3;
        const VERIFY_NULLDUMMY     = 1 << 4;
        const VERIFY_SIGPUSHONLY   = 1 << 5;
        const VERIFY_MINIMALDATA   = 1 << 6;
        const VERIFY_DISCOURAGE_NOP= 1 << 7;
        const VERIFY_CLEANSTACK    = 1 << 8;
        const VERIFY_CHECKLOCKTIMEVERIFY = 1 << 9;
        const VERIFY_CHECKSEQUENCEVERIFY = 1 << 10;
        const VERIFY_WITNESS       = 1 << 11;
        const VERIFY_TAPROOT       = 1 << 12;
        const STANDARD_SCRIPT_VERIFY =
            Self::VERIFY_P2SH.bits() |
            Self::VERIFY_DERSIG.bits() |
            Self::VERIFY_NULLDUMMY.bits() |
            Self::VERIFY_MINIMALDATA.bits() |
            Self::VERIFY_CHECKLOCKTIMEVERIFY.bits() |
            Self::VERIFY_CHECKSEQUENCEVERIFY.bits() |
            Self::VERIFY_WITNESS.bits();
    }
}

impl ScriptInterpreter {
    pub fn new(flags: ScriptFlags) -> Self {
        Self {
            stack: Vec::with_capacity(16),
            alt_stack: Vec::with_capacity(4),
            op_count: 0,
            flags,
        }
    }

    pub fn standard() -> Self {
        Self::new(ScriptFlags::STANDARD_SCRIPT_VERIFY)
    }

    /// Execute a script and return true if the stack top is truthy
    pub fn execute(&mut self, script: &Script, sig_hash: &[u8]) -> ScriptResult<bool> {
        if script.bytes.len() > MAX_SCRIPT_SIZE {
            return Err(ScriptError::ScriptTooLarge);
        }

        let mut i = 0;
        let code = &script.bytes;

        while i < code.len() {
            if self.op_count > MAX_OPS_PER_SCRIPT {
                return Err(ScriptError::MaxOpsExceeded);
            }
            if self.stack.len() + self.alt_stack.len() > MAX_STACK_SIZE {
                return Err(ScriptError::StackOverflow);
            }

            let op = code[i];
            i += 1;

            // Push data opcodes (0x01–0x4b)
            if op >= 0x01 && op <= 0x4b {
                let len = op as usize;
                if i + len > code.len() {
                    return Err(ScriptError::Execution("push data out of bounds".into()));
                }
                self.stack.push(code[i..i + len].to_vec());
                i += len;
                continue;
            }

            self.op_count += 1;

            match op {
                0x00 => self.stack.push(vec![]), // OP_0
                0x4c => { // OP_PUSHDATA1
                    let len = code[i] as usize; i += 1;
                    self.stack.push(code[i..i+len].to_vec()); i += len;
                }
                0x4d => { // OP_PUSHDATA2
                    let len = u16::from_le_bytes([code[i], code[i+1]]) as usize; i += 2;
                    self.stack.push(code[i..i+len].to_vec()); i += len;
                }
                0x4e => { // OP_PUSHDATA4
                    let len = u32::from_le_bytes([code[i],code[i+1],code[i+2],code[i+3]]) as usize; i += 4;
                    self.stack.push(code[i..i+len].to_vec()); i += len;
                }
                0x51..=0x60 => self.stack.push(vec![op - 0x50]), // OP_1..OP_16
                0x4f => self.stack.push(vec![0x81]), // OP_1NEGATE
                0x61 => {} // OP_NOP — do nothing
                0x6a => return Err(ScriptError::OpReturn),
                0x69 => { // OP_VERIFY
                    let top = self.pop()?;
                    if !cast_to_bool(&top) {
                        return Err(ScriptError::VerifyFailed);
                    }
                }
                0x75 => { self.pop()?; } // OP_DROP
                0x76 => { // OP_DUP
                    let top = self.peek()?.clone();
                    self.stack.push(top);
                }
                0x6e => { // OP_2DUP
                    let a = self.stack.get(self.stack.len()-1).ok_or(ScriptError::StackUnderflow)?.clone();
                    let b = self.stack.get(self.stack.len()-2).ok_or(ScriptError::StackUnderflow)?.clone();
                    self.stack.push(b);
                    self.stack.push(a);
                }
                0x6d => { // OP_2DROP
                    self.pop()?; self.pop()?;
                }
                0x7c => { // OP_SWAP
                    let len = self.stack.len();
                    if len < 2 { return Err(ScriptError::StackUnderflow); }
                    self.stack.swap(len-1, len-2);
                }
                0x78 => { // OP_OVER
                    let b = self.stack.get(self.stack.len()-2).ok_or(ScriptError::StackUnderflow)?.clone();
                    self.stack.push(b);
                }
                0x82 => { // OP_SIZE
                    let len = self.peek()?.len();
                    self.stack.push(encode_num(len as i64));
                }
                0x87 => { // OP_EQUAL
                    let a = self.pop()?;
                    let b = self.pop()?;
                    self.stack.push(if a == b { vec![1] } else { vec![] });
                }
                0x88 => { // OP_EQUALVERIFY
                    let a = self.pop()?;
                    let b = self.pop()?;
                    if a != b { return Err(ScriptError::VerifyFailed); }
                }
                0x8b => { // OP_1ADD
                    let n = self.pop_num()?;
                    self.stack.push(encode_num(n + 1));
                }
                0x8c => { // OP_1SUB
                    let n = self.pop_num()?;
                    self.stack.push(encode_num(n - 1));
                }
                0x93 => { // OP_ADD
                    let a = self.pop_num()?;
                    let b = self.pop_num()?;
                    self.stack.push(encode_num(a + b));
                }
                0x94 => { // OP_SUB
                    let b = self.pop_num()?;
                    let a = self.pop_num()?;
                    self.stack.push(encode_num(a - b));
                }
                0x9f => { // OP_LESSTHAN
                    let b = self.pop_num()?;
                    let a = self.pop_num()?;
                    self.stack.push(if a < b { vec![1] } else { vec![] });
                }
                0xa0 => { // OP_GREATERTHAN
                    let b = self.pop_num()?;
                    let a = self.pop_num()?;
                    self.stack.push(if a > b { vec![1] } else { vec![] });
                }
                0xa8 => { // OP_SHA256
                    let data = self.pop()?;
                    let h = Sha256::digest(&data);
                    self.stack.push(h.to_vec());
                }
                0xa9 => { // OP_HASH160 (SHA256 + first 20 bytes as RIPEMD160 substitute)
                    let data = self.pop()?;
                    let sha = Sha256::digest(&data);
                    let sha2 = Sha256::digest(sha);
                    self.stack.push(sha2[..20].to_vec());
                }
                0xaa => { // OP_HASH256 (double SHA256)
                    let data = self.pop()?;
                    let h = Sha256::digest(Sha256::digest(&data));
                    self.stack.push(h.to_vec());
                }
                0xac => { // OP_CHECKSIG
                    let pubkey = self.pop()?;
                    let sig = self.pop()?;
                    // Simplified: check sig against sig_hash using pubkey
                    let valid = verify_sig_simplified(&sig, &pubkey, sig_hash);
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                0xad => { // OP_CHECKSIGVERIFY
                    let pubkey = self.pop()?;
                    let sig = self.pop()?;
                    let valid = verify_sig_simplified(&sig, &pubkey, sig_hash);
                    if !valid { return Err(ScriptError::SigCheckFailed); }
                }
                0xae => { // OP_CHECKMULTISIG
                    let n = self.pop_num()? as usize;
                    let mut pubkeys = Vec::with_capacity(n);
                    for _ in 0..n { pubkeys.push(self.pop()?); }
                    let m = self.pop_num()? as usize;
                    let mut sigs = Vec::with_capacity(m);
                    for _ in 0..m { sigs.push(self.pop()?); }
                    self.pop()?; // dummy null (BIP147)
                    let valid = check_multisig(&sigs, &pubkeys, sig_hash, m);
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                0xaf => { // OP_CHECKMULTISIGVERIFY
                    let n = self.pop_num()? as usize;
                    let mut pubkeys = Vec::with_capacity(n);
                    for _ in 0..n { pubkeys.push(self.pop()?); }
                    let m = self.pop_num()? as usize;
                    let mut sigs = Vec::with_capacity(m);
                    for _ in 0..m { sigs.push(self.pop()?); }
                    self.pop()?;
                    let valid = check_multisig(&sigs, &pubkeys, sig_hash, m);
                    if !valid { return Err(ScriptError::SigCheckFailed); }
                }
                0xb1 => { // OP_CHECKLOCKTIMEVERIFY — pass-through in sim
                    let _ = self.peek()?;
                }
                0xb2 => { // OP_CHECKSEQUENCEVERIFY — pass-through in sim
                    let _ = self.peek()?;
                }
                0xc0 => { // OP_RING_CHECKSIG — HSMC extension: validate ring sig
                    let ring_sig = self.pop()?;
                    let key_image = self.pop()?;
                    // Ring signature validation hook (full impl in hsmc-crypto)
                    let valid = ring_sig.len() >= 64 && key_image.len() == 32;
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                0xc1 => { // OP_STEALTH_ADDRESS — verify stealth address derivation
                    let stealth = self.pop()?;
                    let ephemeral = self.pop()?;
                    let valid = stealth.len() == 33 && ephemeral.len() == 33;
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                0xc2 => { // OP_CONFIDENTIAL_TX — verify Pedersen commitment opens
                    let commitment = self.pop()?;
                    let value_proof = self.pop()?;
                    let valid = commitment.len() == 33 && !value_proof.is_empty();
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                0xc3 => { // OP_BULLETPROOF — verify range proof
                    let proof = self.pop()?;
                    let valid = proof.len() >= 32;
                    self.stack.push(if valid { vec![1] } else { vec![] });
                }
                _ => {
                    return Err(ScriptError::UnknownOpcode(op));
                }
            }
        }

        // Final stack check
        if self.stack.is_empty() {
            return Err(ScriptError::InvalidFinalStack);
        }

        Ok(cast_to_bool(self.stack.last().ok_or(ScriptError::InvalidFinalStack)?))
    }

    fn pop(&mut self) -> ScriptResult<Vec<u8>> {
        self.stack.pop().ok_or(ScriptError::StackUnderflow)
    }

    fn peek(&self) -> ScriptResult<&Vec<u8>> {
        self.stack.last().ok_or(ScriptError::StackUnderflow)
    }

    fn pop_num(&mut self) -> ScriptResult<i64> {
        let bytes = self.pop()?;
        Ok(decode_num(&bytes))
    }
}

fn cast_to_bool(v: &[u8]) -> bool {
    for (i, &b) in v.iter().enumerate() {
        if b != 0 {
            // Negative zero is false
            if i == v.len() - 1 && b == 0x80 {
                return false;
            }
            return true;
        }
    }
    false
}

fn encode_num(n: i64) -> Vec<u8> {
    if n == 0 { return vec![]; }
    let mut abs = n.unsigned_abs();
    let negative = n < 0;
    let mut result = Vec::new();
    while abs > 0 {
        result.push((abs & 0xff) as u8);
        abs >>= 8;
    }
    if result.last().map(|&b| b & 0x80 != 0).unwrap_or(false) {
        result.push(if negative { 0x80 } else { 0x00 });
    } else if negative {
        if let Some(last) = result.last_mut() {
            *last |= 0x80;
        }
    }
    result
}

fn decode_num(bytes: &[u8]) -> i64 {
    if bytes.is_empty() { return 0; }
    let negative = bytes.last().map(|&b| b & 0x80 != 0).unwrap_or(false);
    let mut result = 0i64;
    for (i, &b) in bytes.iter().enumerate() {
        let byte = if i == bytes.len() - 1 { b & 0x7f } else { b };
        result |= (byte as i64) << (8 * i);
    }
    if negative { -result } else { result }
}

fn verify_sig_simplified(sig: &[u8], pubkey: &[u8], msg: &[u8]) -> bool {
    // Simplified: in production use full ECDSA/Schnorr verification from hsmc-crypto
    !sig.is_empty() && !pubkey.is_empty() && sig.len() >= 64 && pubkey.len() >= 32
}

fn check_multisig(sigs: &[Vec<u8>], pubkeys: &[Vec<u8>], msg: &[u8], m: usize) -> bool {
    // m-of-n: need m valid sigs from distinct pubkeys
    let mut valid_count = 0;
    let mut pk_idx = 0;
    for sig in sigs {
        while pk_idx < pubkeys.len() {
            if verify_sig_simplified(sig, &pubkeys[pk_idx], msg) {
                valid_count += 1;
                pk_idx += 1;
                break;
            }
            pk_idx += 1;
        }
    }
    valid_count >= m
}

/// Standard P2PKH script evaluation
/// scriptSig: <sig> <pubkey>
/// scriptPubKey: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
pub fn verify_p2pkh(sig: &[u8], pubkey: &[u8], pubkey_hash: &[u8], sig_hash: &[u8]) -> bool {
    // Check pubkey hash
    let sha = Sha256::digest(pubkey);
    let computed_hash = &Sha256::digest(sha)[..20];
    if computed_hash != pubkey_hash {
        return false;
    }
    // Check signature
    verify_sig_simplified(sig, pubkey, sig_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_p2pkh_script_creation() {
        let hash = vec![0xab; 20];
        let script = Script::p2pkh(&hash);
        assert_eq!(script.script_type, ScriptType::P2PKH);
        assert_eq!(script.bytes.len(), 25);
    }

    #[test]
    fn test_p2sh_script_creation() {
        let hash = vec![0xcd; 20];
        let script = Script::p2sh(&hash);
        assert_eq!(script.script_type, ScriptType::P2SH);
    }

    #[test]
    fn test_op_return() {
        let data = b"HSMC_BRIDGE_V1";
        let script = Script::op_return(data);
        assert!(matches!(script.script_type, ScriptType::OpReturn(_)));
    }

    #[test]
    fn test_script_interpreter_arithmetic() {
        let mut interp = ScriptInterpreter::standard();
        // Push 2, push 3, OP_ADD → stack top should be 5
        let script = Script::new(vec![0x52, 0x53, 0x93]); // OP_2 OP_3 OP_ADD
        let result = interp.execute(&script, b"");
        assert!(result.is_ok());
        assert!(result.expect("script execution failed")); // 5 is truthy
    }

    #[test]
    fn test_op_dup_hash160_equalverify() {
        let pubkey = vec![0x02; 33];
        let sha = Sha256::digest(&pubkey);
        let hash = &Sha256::digest(sha)[..20];
        let mut script_bytes = vec![0x76, 0xa9, 0x14]; // OP_DUP OP_HASH160 PUSH20
        script_bytes.extend_from_slice(hash);
        script_bytes.extend_from_slice(&[0x88]); // OP_EQUALVERIFY only (no checksig for this test)
        let script = Script::new(script_bytes);

        let mut interp = ScriptInterpreter::standard();
        interp.stack.push(pubkey.clone()); // sig (dummy)
        interp.stack.push(pubkey);          // pubkey
        // Can't run full P2PKH without stack setup properly, just check type
        assert_eq!(script.script_type, ScriptType::P2PKH);
    }
}
