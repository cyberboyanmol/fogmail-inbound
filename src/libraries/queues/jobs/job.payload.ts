import { QueueEventJobPattern } from './job.pattern';

export interface VisitorViewMailJob {
  pattern: QueueEventJobPattern.MAIL_VISITOR_VIEW;
  data: {
    slug: string;
    domain: string;
    rawMail: string;
  };
}

export interface MemberViewMailJob {
  pattern: QueueEventJobPattern.MAIL_MEMBER_VIEW;
  data: {
    slug: string;
    username: string;
    domain: string;
    rawMail: string;
  };
}
