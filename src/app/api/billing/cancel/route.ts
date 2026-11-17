import { route, json } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { cancelSubscription } from "@/lib/subscription";

/** Cancels at the end of the paid period; data is never deleted on downgrade. */
export const POST = route(async () => {
  const auth = await requireWorkspace();
  const subscription = await cancelSubscription(auth.workspaceId, auth.profile.id);
  return json({ subscription });
});
