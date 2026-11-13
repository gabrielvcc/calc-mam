export async function createFirebaseIdentity(config) {
  const [{ initializeApp }, firebaseAuth] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js'),
  ]);
  const app = initializeApp(config);
  const auth = firebaseAuth.getAuth(app);
  await firebaseAuth.setPersistence(auth, firebaseAuth.browserSessionPersistence);
  const provider = new firebaseAuth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await firebaseAuth.getRedirectResult(auth);
  return {
    onChange: (callback) => firebaseAuth.onIdTokenChanged(auth, callback),
    token: (refresh = false) => auth.currentUser?.getIdToken(refresh),
    signOut: () => firebaseAuth.signOut(auth),
    signIn: async () => {
      try {
        await firebaseAuth.signInWithPopup(auth, provider);
      } catch (error) {
        if (error.code === 'auth/popup-blocked') await firebaseAuth.signInWithRedirect(auth, provider);
        else throw error;
      }
    },
  };
}
