import { firebaseConfig, ownerEmail } from './firebase-config.js';

let runtime;
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

export function ownerClaims(claims) {
  return claims?.email?.toLowerCase() === ownerEmail.toLowerCase()
    && claims.email_verified === true
    && claims.firebase?.sign_in_provider === 'google.com';
}

export async function getAdminSession() {
  const { auth } = await authRuntime();
  if (!auth.currentUser) return { authenticated: false, setup_required: false, auth_mode: 'firebase', owner_email: ownerEmail };
  const result = await auth.currentUser.getIdTokenResult();
  return { authenticated: ownerClaims(result.claims), setup_required: false, auth_mode: 'firebase', owner_email: ownerEmail };
}

export async function getAdminToken() {
  const { auth } = await authRuntime();
  if (!auth.currentUser) throw Object.assign(new Error('请先使用站点所有者的 Google 账号登录'), { status: 401 });
  const result = await auth.currentUser.getIdTokenResult();
  if (!ownerClaims(result.claims)) throw Object.assign(new Error(`此账号没有管理权限，请使用 ${ownerEmail} 登录`), { status: 403 });
  return result.token;
}

export async function signInAdmin() {
  const { sdk, auth } = await authRuntime();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: ownerEmail, prompt: 'select_account' });
  try {
    const { user } = await sdk.signInWithPopup(auth, provider);
    if (!ownerClaims((await user.getIdTokenResult()).claims)) {
      await sdk.signOut(auth);
      throw new Error(`仅 ${ownerEmail} 可以查看测评结果，请选择该账号`);
    }
    return await getAdminSession();
  } catch (error) {
    const messages = {
      'auth/popup-blocked': '浏览器拦截了登录窗口，请允许本站弹出窗口后重试',
      'auth/popup-closed-by-user': '登录窗口已关闭，请重新登录',
      'auth/unauthorized-domain': '此网址尚未加入 Firebase 登录授权域，请联系管理员',
      'auth/network-request-failed': 'Google 登录连接失败，请检查管理员设备网络后重试',
      'auth/operation-not-allowed': 'Firebase 尚未启用 Google 登录',
    };
    throw new Error(messages[error.code] || error.message || '登录未完成，请重试');
  }
}

export async function signOutAdmin() {
  const { sdk, auth } = await authRuntime();
  await sdk.signOut(auth);
  return { ok: true };
}
