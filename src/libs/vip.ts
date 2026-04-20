'use server';

import { currentUser } from '@clerk/nextjs/server';

import { VIP_EMAILS } from '@/utils/AppConfig';

export async function isVipUser(): Promise<boolean> {
  try {
    const user = await currentUser();
    if (!user) {
      return false;
    }
    const email = user.emailAddresses?.[0]?.emailAddress;
    return !!email && VIP_EMAILS.has(email);
  } catch {
    return false;
  }
}
