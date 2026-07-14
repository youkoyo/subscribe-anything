import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  llmProviders,
  promptTemplates,
  searchProviderConfig,
  discoverySourceCatalog,
  industryConfigs,
  subscriptions,
  sources,
  messageCards,
  notifications,
  favorites,
  managedBuildLogs,
  industryMonitoringProfiles,
  userIndustrySubscriptions,
  industryDeliveryRuns,
  userDeliveryLogs,
} from '@/lib/db/schema';

export type LLMProvider = InferSelectModel<typeof llmProviders>;
export type NewLLMProvider = InferInsertModel<typeof llmProviders>;

export type PromptTemplate = InferSelectModel<typeof promptTemplates>;
export type NewPromptTemplate = InferInsertModel<typeof promptTemplates>;

export type SearchProviderConfig = InferSelectModel<typeof searchProviderConfig>;

export type DiscoverySourceCatalogEntry = InferSelectModel<typeof discoverySourceCatalog>;
export type NewDiscoverySourceCatalogEntry = InferInsertModel<typeof discoverySourceCatalog>;

export type IndustryConfig = InferSelectModel<typeof industryConfigs>;
export type NewIndustryConfig = InferInsertModel<typeof industryConfigs>;

export type Subscription = InferSelectModel<typeof subscriptions>;
export type NewSubscription = InferInsertModel<typeof subscriptions>;

export type Source = InferSelectModel<typeof sources>;
export type NewSource = InferInsertModel<typeof sources>;

export type MessageCard = InferSelectModel<typeof messageCards>;
export type NewMessageCard = InferInsertModel<typeof messageCards>;

export type Notification = InferSelectModel<typeof notifications>;
export type NewNotification = InferInsertModel<typeof notifications>;

export type Favorite = InferSelectModel<typeof favorites>;
export type NewFavorite = InferInsertModel<typeof favorites>;

export type ManagedBuildLog = InferSelectModel<typeof managedBuildLogs>;
export type NewManagedBuildLog = InferInsertModel<typeof managedBuildLogs>;

export type IndustryMonitoringProfile = InferSelectModel<typeof industryMonitoringProfiles>;
export type NewIndustryMonitoringProfile = InferInsertModel<typeof industryMonitoringProfiles>;

export type UserIndustrySubscription = InferSelectModel<typeof userIndustrySubscriptions>;
export type NewUserIndustrySubscription = InferInsertModel<typeof userIndustrySubscriptions>;

export type IndustryDeliveryRun = InferSelectModel<typeof industryDeliveryRuns>;
export type NewIndustryDeliveryRun = InferInsertModel<typeof industryDeliveryRuns>;

export type UserDeliveryLog = InferSelectModel<typeof userDeliveryLogs>;
export type NewUserDeliveryLog = InferInsertModel<typeof userDeliveryLogs>;
