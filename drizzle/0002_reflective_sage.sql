ALTER TABLE `positions` ADD `verified` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `positions` ADD `onChainShares` decimal(18,6);--> statement-breakpoint
ALTER TABLE `positions` ADD `verifiedAt` timestamp;