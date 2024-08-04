import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IConfiguration } from '../interfaces/smtp.interface';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as shell from 'shelljs';
import { SMTPServer } from 'smtp-server';
import { v4 as uuidv4 } from 'uuid';
import { MailUtilitiesService } from './mail-utilities.service';
import { ConfigService } from '@nestjs/config';
import { InjectInboundMailParseQueue } from 'src/libraries/queues/decorators/inject-queue.decorator';
import { Queue } from 'bullmq';
import {
  MemberViewMailJob,
  VisitorViewMailJob,
} from 'src/libraries/queues/jobs/job.payload';
import { QueueEventJobPattern } from 'src/libraries/queues/jobs/job.pattern';
import { JobPriority } from 'src/libraries/queues/jobs/job.priority';

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  public configuration: IConfiguration;
  private logger = new Logger(SmtpService.name);
  private smtp: SMTPServer;
  constructor(
    private readonly mailUtilities: MailUtilitiesService,
    private readonly configService: ConfigService,
    @InjectInboundMailParseQueue() private _inboundMailParseService: Queue,
  ) {
    this.onAuth = this.onAuth.bind(this);
    this.onMailFrom = this.onMailFrom.bind(this);
    this.onRcptTo = this.onRcptTo.bind(this);
    this.onData = this.onData.bind(this);

    this.configuration = {
      port: this.configService.get<number>('PORT'),
      tmp: this.configService.get<string>('TMP'),
      profile: this.configService.get<string>('PROFILE') === 'true',
      disableDkim: this.configService.get<string>('DISABLE_DKIM') === 'true',
      disableSpamScore:
        this.configService.get<string>('DISABLE_SPAM_SCORE') === 'true',
      disableSpf: this.configService.get<string>('DISABLE_SPF') === 'true',
      domain_lists: this.configService.get<string[]>('DOMAIN_LISTS'),
    };
  }
  onModuleInit() {
    try {
      this.start();
    } catch (error) {
      this.logger.error('Failed to start SMTP service', error);
      throw error;
    }
  }
  onModuleDestroy() {
    this.stop();
  }

  private enableMemoryProfiling() {
    this.logger.log('Enable memory profiling');
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const ram = memoryUsage.rss + memoryUsage.heapUsed;
      const million = 1000000;
      this.logger.debug(
        `Ram Usage: ${ram / million}mb | rss: ${memoryUsage.rss / million}mb | heapTotal: ${
          memoryUsage.heapTotal / million
        }mb | heapUsed: ${memoryUsage.heapUsed / million}`,
      );
    }, 500);
  }

  private start() {
    if (!fs.existsSync(this.configuration.tmp)) {
      shell.mkdir('-p', this.configuration.tmp);
    }

    /* Basic memory profiling. */
    if (this.configuration.profile) {
      this.enableMemoryProfiling();
    }

    const server = new SMTPServer({
      authOptional: true,
      allowInsecureAuth: true,
      secure: false,
      onAuth: this.onAuth,
      onData: this.onData,
      onMailFrom: this.onMailFrom,
      onRcptTo: this.onRcptTo,
    });

    this.smtp = server;
    server.listen(this.configuration.port, () => {
      this.logger.log(
        '🚀  Smtp server listening on port ' + this.configuration.port,
      );
    });

    server.on('close', () => {
      this.logger.fatal('Closing smtp server');
    });

    server.on('error', (error) => {
      if (this.configuration.port < 1000) {
        this.logger.error('Ports under 1000 require root privileges.');
      }

      this.logger.error('Server errored');
      this.logger.error(error);
    });
  }

  public stop() {
    this.logger.warn('Stopping inbound-smtp server.');
    if (this.smtp) {
      this.smtp.close(() => {
        this.logger.log('SMTP server closed successfully');
      });
    }
  }

  private onAuth(auth, session, callback) {
    // TODO have to handle later. when  {authOptional:false}
    callback(null);
  }

  private async onMailFrom(address, session, callback) {
    try {
      this.logger.verbose(
        `onMailFrom: ${address.address}, session: ${session.id}`,
      );
      callback();
    } catch (error) {
      this.logger.error(`Error in onMailFrom: ${error.message}`, error.stack);
      callback(new Error('Error processing mail from address'));
    }
  }

  private async onRcptTo(address, session, callback) {
    try {
      this.logger.verbose(
        `onRcptTo: ${address.address}, session: ${session.id}`,
      );
      // TODO: Implement recipient address verification
      callback();
    } catch (error) {
      this.logger.error(`Error in onRcptTo: ${error.message}`, error.stack);
      callback(new Error('Error processing recipient address'));
    }
  }

  private onData(stream, session, callback) {
    const connection = _.cloneDeep(session);
    connection.id = uuidv4();
    const mailPath = path.join(this.configuration.tmp, connection.id);
    connection.mailPath = mailPath;

    this.logger.verbose(`Connection id ${connection.id}`);
    this.logger.verbose(
      `${connection.id} Receiving message from ${connection.envelope.mailFrom.address}`,
    );

    const writeStream = fs.createWriteStream(mailPath);

    stream.pipe(writeStream);

    stream.on('error', (error) => {
      this.logger.error(`Stream error for ${connection.id}`, error);
      fs.unlink(mailPath, (unlinkError) => {
        if (unlinkError) {
          this.logger.error(`Failed to delete file ${mailPath}`, unlinkError);
        }
      });
      callback(error);
    });

    writeStream.on('error', (error) => {
      this.logger.error(`Write stream error for ${connection.id}`, error);
      callback(error);
    });

    writeStream.on('finish', async () => {
      try {
        await this.dataReady(connection);
        callback();
      } catch (error) {
        this.logger.error(`Error in dataReady for ${connection.id}`, error);
        callback(error);
      }
    });
  }

  private async dataReady(connection) {
    try {
      this.logger.verbose(
        `${connection.id} Processing message from ${connection.envelope.mailFrom.address}`,
      );

      // Get the raw email from the temp directory.
      const rawEmail = await this.retrieveRawEmail(connection);

      const jobPromises = connection.envelope.rcptTo.map(async (toAddress) => {
        const { isMember, slug, username, domain } = this.parseEmailAddress(
          toAddress.address.toLowerCase(),
          this.configuration.domain_lists,
        );

        if (!domain) {
          throw new Error('Invalid Email');
        }

        const baseJobData = { slug, rawMail: JSON.stringify(rawEmail), domain };

        if (isMember) {
          const jobData: MemberViewMailJob['data'] = {
            ...baseJobData,
            username,
          };
          this.logger.verbose('triggering job for handling member view mail');
          return this._inboundMailParseService.add(
            QueueEventJobPattern.MAIL_MEMBER_VIEW,
            jobData,
            {
              priority: JobPriority.HIGHEST,
            },
          );
        } else {
          const jobData: VisitorViewMailJob['data'] = baseJobData;
          this.logger.verbose('triggering job for handling visitor view mail');
          return this._inboundMailParseService.add(
            QueueEventJobPattern.MAIL_VISITOR_VIEW,
            jobData,
            {
              priority: JobPriority.HIGH,
            },
          );
        }
      });

      await Promise.all(jobPromises);
    } catch (error) {
      this.logger.error('Exception occurred while performing onData callback');
      this.logger.error(error);
      throw error;
    }
  }

  private async retrieveRawEmail(connection) {
    try {
      const rawEmail = await fs.promises.readFile(connection.mailPath, 'utf8');
      await fs.promises.unlink(connection.mailPath);
      return rawEmail;
    } catch (error) {
      this.logger.error(
        `Error processing email file: ${connection.mailPath}`,
        error,
      );

      throw error;
    }
  }

  private parseEmailAddress(
    address: string,
    domains: string[],
  ): {
    isMember: boolean;
    slug: string | null;
    username: string | null;
    domain: string | null;
  } {
    const lowerCaseAddress = address.toLowerCase();
    const parts = lowerCaseAddress.split('@');

    if (parts.length < 2) {
      return { isMember: false, slug: null, username: null, domain: null };
    }

    const slugPart = parts[0];
    const domainPart = parts.slice(1).join('@');
    const domainParts = domainPart.split('.');

    if (domainParts.length < 2) {
      return { isMember: false, slug: null, username: null, domain: null };
    }

    const tld = domainParts.pop()!;
    const mainDomain = domainParts.pop()!;
    const fullDomain = `${mainDomain}.${tld}`;

    if (!domains.includes(fullDomain)) {
      return { isMember: false, slug: null, username: null, domain: null };
    }

    if (domainParts.length === 0) {
      // Case 1: *@domain.tld
      return {
        isMember: false,
        slug: slugPart,
        username: null,
        domain: fullDomain,
      };
    } else {
      // Case 2: *@*.domain.tld
      return {
        isMember: true,
        slug: slugPart,
        username: domainParts.join('.'),
        domain: fullDomain,
      };
    }
  }

  // private async validateDkim(connection, rawEmail) {
  //   if (configuration.disableDkim) {
  //     return false;
  //   }

  //   this.logger.verbose(connection.id + ' Validating DKIM.');
  //   try {
  //     return await this.mailUtilities.validateDkim(rawEmail);
  //   } catch (err) {
  //     this.logger.error(connection.id + ' DKIM validation failed.');
  //     this.logger.error(err);
  //     return false;
  //   }
  // }

  // private async validateSpf(connection) {
  //   if (configuration.disableSpf) {
  //     return false;
  //   }

  //   this.logger.verbose(connection.id + ' Validating SPF.');
  //   try {
  //     return await this.mailUtilities.validateSpf(
  //       connection.remoteAddress,
  //       connection.from,
  //       connection.clientHostname,
  //     );
  //   } catch (err) {
  //     this.logger.error(connection.id + ' SPF validation failed.');
  //     this.logger.error(err);
  //     return false;
  //   }
  // }

  // private async computeSpamScore(connection, rawEmail) {
  //   if (configuration.disableSpamScore) {
  //     return 0.0;
  //   }

  //   try {
  //     return await this.mailUtilities.computeSpamScore(rawEmail);
  //   } catch (err) {
  //     this.logger.error(connection.id + ' Spam score computation failed.');
  //     this.logger.error(err);
  //     return 0.0;
  //   }
  // }
}
