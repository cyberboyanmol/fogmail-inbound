import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IConfiguration, ISmtpOptions } from './smtp.interface';
import { MailParser } from 'mailparser';
import _ from 'lodash';
import Promise from 'bluebird';
import { convert } from 'html-to-text';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import path from 'path';
import * as shell from 'shelljs';
import util from 'util';
import { SMTPServer } from 'smtp-server';
import uuid from 'uuid';
import dns from 'dns';
import net from 'net';
import * as extend from 'extend';
import { MailUtilitiesService } from './mail-utilities.service';
const LOG_CONTEXT = 'Mailin';
import LanguageDetect from 'languagedetect';
import { ConfigService } from '@nestjs/config';
// import logger from '../helpers/logger';
const configuration = {
  disableDnsLookup: false,
  disableDNSValidation: false,
  port: 25,
  host: '127.0.0.1',
  tmp: 'InboundMails',
  profile: true,
};
interface ParsedMail {
  text?: string;
  html?: string;
  [key: string]: unknown;
}
@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  public configuration: IConfiguration;
  private logger = new Logger(SmtpService.name);
  private smtp: SMTPServer;
  constructor(
    private readonly mailUtilities: MailUtilitiesService,
    private configService: ConfigService,
  ) {}
  onModuleInit() {
    this.start();
  }
  onModuleDestroy() {
    this.stop();
  }

  private start() {
    if (!fs.existsSync(configuration.tmp)) {
      shell.mkdir('-p', configuration.tmp);
    }
    /* Basic memory profiling. */
    if (configuration.profile) {
      this.logger.log('Enable memory profiling');
      // setInterval(() => {
      //   const memoryUsage = process.memoryUsage();
      //   const ram = memoryUsage.rss + memoryUsage.heapUsed;
      //   const million = 1000000;
      //   this.logger.debug(
      //     'Ram Usage: ' +
      //       ram / million +
      //       'mb | rss: ' +
      //       memoryUsage.rss / million +
      //       'mb | heapTotal: ' +
      //       memoryUsage.heapTotal / million +
      //       'mb | heapUsed: ' +
      //       memoryUsage.heapUsed / million,
      //   );
      // }, 500);
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
    server.listen(configuration.port, configuration.host, () => {
      this.logger.log('Smtp server listening on port ' + configuration.port);
    });

    server.on('close', () => {
      this.logger.fatal('Closing smtp server');
    });

    server.on('error', (error) => {
      if (configuration.port < 1000) {
        this.logger.error('Ports under 1000 require root privileges.');
      }

      this.logger.error('Server errored');
      this.logger.error(error);
    });
  }

  public stop() {
    this.logger.fatal('Stopping inbound-smtp server.');
    /*
     * FIXME A bug in the RAI module prevents the callback to be called, so
     * call end and call the callback directly.
     */
    this.smtp.close();
  }

  private onAuth(auth, session, streamCallback) {
    // TODO have to handle later. when  {authOptional:false}
    streamCallback();
  }

  private onMailFrom(address, session, streamCallback) {
    const ack = function (err) {
      streamCallback(err);
    };
    this.validateAddress('sender', address.address).then(ack).catch(ack);
  }

  private onRcptTo(address, session, streamCallback) {
    const ack = function (err) {
      streamCallback(err);
    };
    this.validateAddress('recipient', address.address).then(ack).catch(ack);
  }

  private onData(stream, session, onDataCallback) {
    try {
      // const _session = session;
      const connection = _.cloneDeep(session);
      connection.id = uuid.v4();
      const mailPath = path.join(configuration.tmp, connection.id);
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
        this.logger.log('data', connection, chunk);
      });

      stream.on('end', async () => {
        await this.dataReady(connection);
        onDataCallback();
      });

      stream.on('close', () => {
        this.logger.verbose('close', connection);
      });

      stream.on('error', (error) => {
        this.logger.error('error', connection, error);
      });
    } catch (error) {
      this.logger.error('Exception occurred while performing onData callback');
      this.logger.error(error);
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
    const [parsedEmail] = await Promise.all([this.parsedEmail(connection)]);
    console.log(parsedEmail, 'parsedEmail');
  }

  private async retrieveRawEmail(connection) {
    const rawEmail = await fs.promises.readFile(connection.mailPath);
    return rawEmail.toString();
  }

  private async parsedEmail(connection) {
    this.logger.verbose(`${connection.id} Parsing email.`);
    /* Prepare the mail parser. */
    const mailParser = new MailParser();
    const mail = await new Promise((resolve) => {
      mailParser.on('end', resolve);
      fs.createReadStream(connection.mailPath).pipe(mailParser);
    });
    // Type guard to ensure mail is an object
    if (typeof mail !== 'object' || mail === null) {
      throw new Error('Parsed mail is not an object');
    }
    const parsedMail = mail as ParsedMail;
    /*
     * Make sure that both text and html versions of the
     * body are available.
     */
    if (!parsedMail.text && !parsedMail.html) {
      parsedMail.text = '';
      parsedMail.html = '<div></div>';
    } else if (!parsedMail.html) {
      parsedMail.html = await this._convertTextToHtml(parsedMail.text);
    } else if (!parsedMail.text) {
      parsedMail.text = await this._convertHtmlToText(parsedMail.html);
    }

    return parsedMail;
  }

  private async _convertTextToHtml(text: string) {
    /* Replace newlines by <br>. */
    text = text.replace(/(\n\r)|(\n)/g, '<br>');
    /* Remove <br> at the beginning. */
    text = text.replace(/^\s*(<br>)*\s*/, '');
    /* Remove <br> at the end. */
    text = text.replace(/\s*(<br>)*\s*$/, '');

    return text;
  }

  private async _convertHtmlToText(html: string) {
    return convert(html);
  }

  private async validateAddress(addressType, email) {
    if (configuration.disableDnsLookup) return;

    if (!email) {
      throw new Error(
        `550 5.1.1 <${email}>: ${addressType} address rejected: User unknown in local ${addressType} table`,
      );
    }

    const errorMessage = `450 4.1.8 <${email}>: ${addressType} address rejected: Domain not found`;

    if (!['sender', 'recipient'].includes(addressType)) {
      throw new Error('Address type not supported');
    }

    const domain = email.split('@')[1];

    if (!configuration.disableDNSValidation) {
      try {
        const addresses = await dns.promises.resolveMx(domain);
        if (!addresses || addresses.length === 0) throw new Error(errorMessage);
        console.log(addresses);
        // Sort MX records by priority and attempt to connect
        for (const mx of addresses.sort((a, b) => a.priority - b.priority)) {
          await new Promise((resolve, reject) => {
            const socket = net.createConnection(25, mx.exchange, () => {
              socket.destroy();
              resolve();
            });
            socket.on('error', reject);
          });
          return; // Successfully connected
        }
        throw new Error(errorMessage); // No successful connection
      } catch (err) {
        throw new Error(errorMessage);
      }
    }
  }
}
