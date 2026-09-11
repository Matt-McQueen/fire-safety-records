import type { ItemResponse, SessionUser } from "../types/api";
import { request } from "./http";
import { clearSession, setSession } from "./session";

interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: SessionUser;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await request<ItemResponse<LoginResult>>(
    "POST",
    "/auth/login",
    { email, password },
    { isAuthEndpoint: true },
  );
  setSession({ accessToken: body.data.accessToken, user: body.data.user });
  return body.data.user;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("POST", "/auth/logout", undefined, { isAuthEndpoint: true });
  } finally {
    clearSession();
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  // Deliberately not clearing the session here: AccountPage lives behind the
  // auth guard, which redirects to /login the instant the session is gone -
  // clearing it now would bounce past the confirmation screen before it
  // could ever render. It clears the session itself once the user moves on
  // from that screen.
  await request<void>(
    "POST",
    "/auth/change-password",
    { currentPassword, newPassword },
    { isAuthEndpoint: true },
  );
}

export async function logoutEverywhere(): Promise<void> {
  try {
    await request<void>("POST", "/auth/logout-all", undefined, { isAuthEndpoint: true });
  } finally {
    clearSession();
  }
}
