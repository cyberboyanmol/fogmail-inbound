export interface ISmtpOptions {
  banner: string;
  logger: boolean;
  disabledCommands: string[];
  secure?: boolean;
  debug?: boolean;
}

export interface IConfiguration {
  host: string;
  port: number;
  tmp: string;
  disableWebhook: boolean;
  disableDkim: boolean;
  disableSpf: boolean;
  disableSpamScore: boolean;
  verbose: boolean;
  debug: boolean;
  logLevel: string;
  profile: boolean;
  disableDNSValidation: boolean;
  smtpOptions?: ISmtpOptions;
  disableDnsLookup?: boolean;
}
