// Map raw Supabase auth errors to plain, friendly consumer copy. ASCII only.

export function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login")) return "That email or password is not right.";
  if (m.includes("already registered") || m.includes("user already exists"))
    return "An account with this email already exists. Try logging in instead.";
  if (m.includes("password should be") || m.includes("weak password"))
    return "Please pick a stronger password (at least 6 characters).";
  if (m.includes("unable to validate email") || (m.includes("email") && m.includes("invalid")))
    return "Please enter a valid email address.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("not confirmed"))
    return "Please confirm your email, then log in.";
  return raw;
}
