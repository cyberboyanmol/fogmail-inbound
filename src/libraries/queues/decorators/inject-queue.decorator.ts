import { InjectQueue } from '@nestjs/bullmq';
import { INBOUND_MAIL_PARSE_QUEUE } from '../queue.constant';

export const InjectInboundMailParseQueue = () =>
  InjectQueue(INBOUND_MAIL_PARSE_QUEUE);
