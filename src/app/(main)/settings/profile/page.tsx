import ProfilePanel from "@/components/profile/ProfilePanel";

export default function ProfileSettingsPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#3E3224] mb-2 font-mono">人物画像</h1>
        <p className="text-sm text-[#8B7D6B]">
          管理你的个性化画像信息，影响 AI 对话和记忆检索的行为
        </p>
      </div>
      <ProfilePanel />
    </div>
  );
}
