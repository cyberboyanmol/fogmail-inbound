import { InjectQueue } from '@nestjs/bullmq';
import { INBOUND_MAIL_PARSE_QUEUE } from '../queues';

export const InjectInboundMailParseQueue = () =>
  InjectQueue(INBOUND_MAIL_PARSE_QUEUE);
