'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LLMProviderList from '@/components/settings/LLMProviderList';
import PromptTemplateEditor from '@/components/settings/PromptTemplateEditor';
import SearchProviderForm from '@/components/settings/SearchProviderForm';
import SmtpConfigForm from '@/components/settings/SmtpConfigForm';
import UserPersonalSettings from '@/components/settings/UserPersonalSettings';
import SourcePreferenceList from '@/components/settings/SourcePreferenceList';
import { useAuth } from '@/contexts/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;

  if (isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">配置</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            管理 AI、搜索、提示词和用户服务等企业级能力。
          </p>
        </div>
        <Tabs defaultValue="prompts">
          <TabsList className="w-full overflow-x-auto flex">
            <TabsTrigger value="prompts">提示词模板</TabsTrigger>
            <TabsTrigger value="llm">AI 供应商</TabsTrigger>
            <TabsTrigger value="search">搜索供应商</TabsTrigger>
            <TabsTrigger value="sources">信息源偏好</TabsTrigger>
            <TabsTrigger value="auth">用户服务</TabsTrigger>
          </TabsList>
          <TabsContent value="llm">
            <LLMProviderList />
          </TabsContent>
          <TabsContent value="prompts">
            <PromptTemplateEditor isAdmin />
          </TabsContent>
          <TabsContent value="search">
            <SearchProviderForm />
          </TabsContent>
          <TabsContent value="sources">
            <SourcePreferenceList />
          </TabsContent>
          <TabsContent value="auth">
            <SmtpConfigForm />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">个人配置</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          管理你的订阅条件、接收邮箱和个人侧状态；平台能力由管理员统一配置。
        </p>
      </div>
      <UserPersonalSettings />
    </div>
  );
}
