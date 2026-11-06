import { firebaseConfig, ownerEmail, ownerUid } from './firebase-config.js';

let runtime;
let signInPending = false;
const configuredOwner = () => typeof ownerUid === 'string' && ownerUid.trim().length > 0;
const configurationError = () => Object.assign(new Error('管理员账号尚未配置完成，请稍后再试'), { status: 503 });

async function authRuntime() {
  if (!runtime) runtime = (async () => {
    // These imports run only for HR. Candidates never initialize Firebase Auth.
    const [{ initializeApp, getApps }, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app = getApps().find(a => a.name === 'weieryang-hr') || initializeApp(firebaseConfig, 'weieryang-hr');
    const auth = sdk.getAuth(app);
    await sdk.setPersistence(auth, sdk.browserSessionPersistence);
    await auth.authStateReady();
    return { sdk, auth };
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}

/** Mirrors the database owner check. A known email alone never grants access. */
export function ownerClaims(claims, expectedOwner = { uid: ownerUid, email: ownerEmail }) {
  return typeof expectedOwner?.uid === 'string'
    && expectedOwner.uid.trim().length > 0
    && typeof expectedOwner.email === 'string'
    && expectedOwner.email.length > 0
    && claims?.sub === expectedOwner.uid
    && claims.email === expectedOwner.email
    && claims.firebase?.sign_in_provider === 'password';
}

export async function getAdminSession() {
  const base = { authenticated: false, setup_required: !configuredOwner(), auth_mode: 'password', owner_email: ownerEmail };
  if (!configuredOwner()) return base;
  const { auth } = await authRuntime();
  if (!auth.currentUser) return base;
  const result = await auth.currentUser.getIdTokenResult();
  return { ...base, authenticated: ownerClaims(result.claims) };
}

export async function getAdminToken() {
  if (!configuredOwner()) throw configurationError();
  const { auth } = await authRuntime();
  if (!auth.currentUser) throw Object.assign(new Error('请先使用管理员邮箱和密码登录'), { status: 401 });
  const result = await auth.currentUser.getIdTokenResult();
  if (!ownerClaims(result.claims)) throw Object.assign(new Error('此账号没有管理权限，请使用指定的管理员账号登录'), { status: 403 });
  return result.token;
}

export async function signInAdmin(email, password) {
  if (!configuredOwner()) throw configurationError();
  if (signInPending) throw new Error('正在登录，请稍候');
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalizedEmail !== ownerEmail) throw new Error('请使用页面指定的管理员邮箱登录');
  if (typeof password !== 'string' || password.length === 0) throw new Error('请输入管理员密码');
  signInPending = true;
  try {
    const { sdk, auth } = await authRuntime();
    const { user } = await sdk.signInWithEmailAndPassword(auth, normalizedEmail, password);
    password = '';
    if (!ownerClaims((await user.getIdTokenResult()).claims)) {
      await sdk.signOut(auth);
      throw Object.assign(new Error('此账号没有管理权限，请联系站点所有者'), { code: 'app/owner-mismatch' });
    }
    return await getAdminSession();
  } catch (error) {
    const messages = {
      'auth/invalid-credential': '邮箱或密码不正确，请重新输入',
      'auth/invalid-login-credentials': '邮箱或密码不正确，请重新输入',
      'auth/wrong-password': '邮箱或密码不正确，请重新输入',
      'auth/user-not-found': '邮箱或密码不正确，请重新输入',
      'auth/invalid-email': '请输入有效的管理员邮箱',
      'auth/missing-password': '请输入管理员密码',
      'auth/user-disabled': '此管理员账号已停用，请联系站点所有者',
      'auth/too-many-requests': '登录尝试较多，请稍后再试',
      'auth/network-request-failed': '登录连接失败，请检查管理员设备网络后重试',
      'auth/operation-not-allowed': '管理员邮箱登录尚未启用，请联系站点所有者',
      'app/owner-mismatch': '此账号没有管理权限，请联系站点所有者',
    };
    // Never forward SDK/request details or the supplied credential to the UI.
    throw new Error(messages[error.code] || '登录未完成，请稍后重试');
  } finally {
    password = '';
    signInPending = false;
  }
}

export async function signOutAdmin() {
  const { sdk, auth } = await authRuntime();
  await sdk.signOut(auth);
  return { ok: true };
}
