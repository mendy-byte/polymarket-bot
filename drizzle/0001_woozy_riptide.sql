CREATE TABLE `bot_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_config_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scannedEventId` int NOT NULL,
	`orderId` varchar(256),
	`marketId` varchar(128) NOT NULL,
	`tokenId` varchar(256) NOT NULL,
	`side` varchar(8) NOT NULL,
	`price` decimal(10,6) NOT NULL,
	`size` decimal(18,6) NOT NULL,
	`amountUsd` decimal(18,6) NOT NULL,
	`status` enum('pending','placed','filled','partial','cancelled','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`filledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scannedEventId` int NOT NULL,
	`marketId` varchar(128) NOT NULL,
	`tokenId` varchar(256) NOT NULL,
	`question` text NOT NULL,
	`outcome` varchar(64) NOT NULL,
	`category` varchar(128),
	`entryPrice` decimal(10,6) NOT NULL,
	`shares` decimal(18,6) NOT NULL,
	`costBasis` decimal(18,6) NOT NULL,
	`currentPrice` decimal(10,6),
	`currentValue` decimal(18,6),
	`pnl` decimal(18,6),
	`pnlPercent` decimal(10,2),
	`status` enum('open','resolved_win','resolved_loss','sold') NOT NULL DEFAULT 'open',
	`resolvedAt` timestamp,
	`resolutionPayout` decimal(18,6),
	`endDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scan_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`action` varchar(64) NOT NULL,
	`details` text,
	`marketsScanned` int,
	`cheapFound` int,
	`newDiscovered` int,
	`ordersPlaced` int,
	`errors` int,
	`duration` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scanned_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`marketId` varchar(128) NOT NULL,
	`conditionId` varchar(128),
	`tokenId` varchar(256),
	`question` text NOT NULL,
	`outcome` varchar(64) NOT NULL,
	`slug` varchar(512),
	`eventSlug` varchar(512),
	`category` varchar(128),
	`tags` json,
	`price` decimal(10,6) NOT NULL,
	`liquidity` decimal(18,2),
	`volume` decimal(18,2),
	`bestBid` decimal(10,6),
	`bestAsk` decimal(10,6),
	`spread` decimal(10,6),
	`endDate` timestamp,
	`hoursToResolution` int,
	`aiScore` decimal(5,2),
	`aiReasoning` text,
	`aiEvaluatedAt` timestamp,
	`status` enum('discovered','evaluated','approved','rejected','ordered','filled','resolved_win','resolved_loss','expired') NOT NULL DEFAULT 'discovered',
	`tickSize` decimal(10,4),
	`minOrderSize` int,
	`negRisk` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scanned_events_id` PRIMARY KEY(`id`)
);
