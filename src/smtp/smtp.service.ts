import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IConfiguration } from './smtp.interface';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as shell from 'shelljs';
import { SMTPServer } from 'smtp-server';
import { v4 as uuidv4 } from 'uuid';
import { MailUtilitiesService } from './mail-utilities.service';
import { ConfigService } from '@nestjs/config';
import { InjectInboundMailParseQueue } from 'src/bullmq-queue/decorators/inject-queue.decorator';
import { Queue } from 'bullmq';

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  public configuration: IConfiguration;
  private logger = new Logger(SmtpService.name);
  private smtp: SMTPServer;
  constructor(
    private readonly mailUtilities: MailUtilitiesService,
    private configService: ConfigService,
    @InjectInboundMailParseQueue() private _inboundMailParseService: Queue,
  ) {
    this.onAuth = this.onAuth.bind(this);
    this.onMailFrom = this.onMailFrom.bind(this);
    this.onRcptTo = this.onRcptTo.bind(this);
    this.onData = this.onData.bind(this);

    this.configuration = {
      port: this.configService.get<number>('PORT'),
      tmp: this.configService.get<string>('TMP'),
      profile: this.configService.get<boolean>('PROFILE'),
      disableDkim: this.configService.get<boolean>('DISABLE_DKIM'),
      disableSpamScore: this.configService.get<boolean>('DISABLE_SPAM_SCORE'),
      disableSpf: this.configService.get<boolean>('DISABLE_SPF'),
    };
  }
  onModuleInit() {
    this.start();
  }
  onModuleDestroy() {
    this.stop();
  }

  private start() {
    if (!fs.existsSync(this.configuration.tmp)) {
      shell.mkdir('-p', this.configuration.tmp);
    }
    /* Basic memory profiling. */
    if (this.configuration.profile) {
      this.logger.log('Enable memory profiling');
      setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const ram = memoryUsage.rss + memoryUsage.heapUsed;
        const million = 1000000;
        this.logger.debug(
          'Ram Usage: ' +
            ram / million +
            'mb | rss: ' +
            memoryUsage.rss / million +
            'mb | heapTotal: ' +
            memoryUsage.heapTotal / million +
            'mb | heapUsed: ' +
            memoryUsage.heapUsed / million,
        );
      }, 500);
    }

    const server = new SMTPServer({
      authOptional: true,
      allowInsecureAuth: true,
      secure: false,
      // logger: true,
      onAuth: this.onAuth,
      onData: this.onData,
      onMailFrom: this.onMailFrom,
      onRcptTo: this.onRcptTo,
    });

    this.smtp = server;
    server.listen(this.configuration.port, () => {
      this.logger.log(
        'Smtp server listening on port ' + this.configuration.port,
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
    this.logger.fatal('Stopping inbound-smtp server.');
    this.smtp.close();
  }

  private onAuth(auth, session, streamCallback) {
    // TODO have to handle later. when  {authOptional:false}
    streamCallback();
  }

  private async onMailFrom(address, session, streamCallback) {
    try {
      this.logger.verbose('onRcpTo:', address.address, session.id);
      streamCallback();
    } catch (error) {
      streamCallback(error);
    }
  }

  private async onRcptTo(address, session, streamCallback) {
    try {
      // TODO : IMPLEMENT A METHOD TO VERIFY THE RECIPIENT ADDRESS
      this.logger.verbose('onRcpTo:', address.address, session.id);
      streamCallback();
    } catch (error) {
      streamCallback(error);
    }
  }

  private onData(stream, session, onDataCallback) {
    try {
      // const _session = session;
      const connection = _.cloneDeep(session);
      connection.id = uuidv4();
      const mailPath = path.join(this.configuration.tmp, connection.id);
      connection.mailPath = mailPath;
      this.logger.verbose('Connection id ' + connection.id);
      this.logger.verbose(
        connection.id +
          ' Receiving message from ' +
          connection.envelope.mailFrom.address,
      );

      // write the stream of mail in the temp directory
      stream.pipe(fs.createWriteStream(mailPath));

      stream.on('data', (chunk) => {
        this.logger.log('data', connection.id, chunk);
      });

      stream.on('end', async () => {
        await this.dataReady(connection);
        onDataCallback();
      });

      stream.on('close', () => {
        this.logger.verbose('close', connection.id);
        onDataCallback();
      });

      stream.on('error', (error) => {
        this.logger.error('error', connection, error);
        onDataCallback(error);
      });
    } catch (error) {
      this.logger.error('Exception occurred while performing onData callback');
      this.logger.error(error);
      onDataCallback(error);
    }
  }

  private async dataReady(connection) {
    this.logger.verbose(
      connection.id +
        ' Processing message from ' +
        connection.envelope.mailFrom.address,
    );

    //  Get the raw email from the temp directory.
    const rawEmail = await this.retrieveRawEmail(connection);

    this.logger.fatal(rawEmail, 'parsedEmail');
  }

  private async retrieveRawEmail(connection) {
    const rawEmail = await fs.promises.readFile(connection.mailPath);
    return rawEmail.toString();
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
