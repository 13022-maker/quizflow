import { OrganizationList } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

const OrganizationSelectionPage = () => (
  <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
    <div className="w-full max-w-md space-y-6">
      {/* 歡迎引導文字 */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          歡迎使用 QuizFlow 👋
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          只差一步！請建立你的「工作空間」來管理測驗。
          <br />
          你可以用學校名稱或自己的名字命名，之後隨時可以改。
        </p>
      </div>

      {/* Clerk 組織建立元件 */}
      <OrganizationList
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
        hidePersonal
        skipInvitationScreen
      />

      {/* 底部補充說明 */}
      <p className="text-center text-xs text-muted-foreground">
        💡 工作空間 = 你的出題資料夾。所有測驗、學生作答資料都存在這裡。
      </p>
    </div>
  </div>
);

export const dynamic = 'force-dynamic';

export default OrganizationSelectionPage;
