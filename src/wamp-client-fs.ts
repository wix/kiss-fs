import {Connection, Session} from 'autobahn';
import {Correlation, FileSystem, fileSystemEventNames} from './api';
import {InternalEventsEmitter, makeEventsEmitter, makeCorrelationId} from "./utils";
import {timeoutPromise} from './promise-utils';
import {Directory, File, ShallowDirectory} from "./model";

export const noConnectionError = `WampClientFileSystem hasn't opened connection yet (forgot to init()?).`

export class WampClientFileSystem implements FileSystem {
    public readonly events: InternalEventsEmitter = makeEventsEmitter();
    private connection: Connection;
    private session: Session;
    private realmPrefix: string;

    constructor(public baseUrl: string, private realm: string, private initTimeout: number = 5000) {
        this.realm = realm;
        this.connection = new Connection({url: baseUrl, realm});
    }

    init(): Promise<WampClientFileSystem> {
        const {baseUrl, initTimeout, connection} = this
        return timeoutPromise(new Promise<WampClientFileSystem>(resolve => {
            connection.open();
            connection.onopen = (session: Session) => {
                this.session = session;
                this.realmPrefix = this.realm.replace(/(.*\..*)(\..*)$/, '$1.'); // 'xxx.yyy.zzz' => 'xxx.yyy.'
                fileSystemEventNames.forEach(fsEvent => {
                    this.session.subscribe(
                        this.realmPrefix + fsEvent,
                        res => this.events.emit(fsEvent, res && res[0])
                    )
                });
                resolve(this)
            };
        }), initTimeout, `Cant't open connection to the WAMP server at ${baseUrl} for ${initTimeout}ms.`);
    }

    async saveFile(fullPath: string, newContent: string, correlation:Correlation = makeCorrelationId()):Promise<Correlation> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<Correlation>(`${this.realmPrefix}saveFile`, [fullPath, newContent, correlation]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteFile(fullPath: string, correlation:Correlation = makeCorrelationId()):Promise<Correlation> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<Correlation>(`${this.realmPrefix}deleteFile`, [fullPath, correlation]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteDirectory(fullPath: string, recursive?: boolean, correlation:Correlation = makeCorrelationId()):Promise<Correlation> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<Correlation>(`${this.realmPrefix}deleteDirectory`, [fullPath, recursive, correlation]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async ensureDirectory(fullPath: string, correlation:Correlation = makeCorrelationId()):Promise<Correlation> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<Correlation>(`${this.realmPrefix}ensureDirectory`, [fullPath, correlation]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async loadTextFile(fullPath: string): Promise<string> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<string>(`${this.realmPrefix}loadTextFile`, [fullPath]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async loadDirectoryTree(fullPath: string = ''): Promise<Directory> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<Directory>(`${this.realmPrefix}loadDirectoryTree`, [fullPath]);
        } catch (error) {
            throw new Error(error);
        }
    }

    async loadDirectoryChildren(fullPath: string): Promise<(File | ShallowDirectory)[]> {
        this.throwIfDisconnected();

        try {
            return await this.session.call<(File | ShallowDirectory)[]>(`${this.realmPrefix}loadDirectoryChildren`, [fullPath]);
        } catch (error) {
            throw new Error(error);
        }
    }

    dispose() {
        this.connection && this.connection.close();
    }

    private throwIfDisconnected() {
        if (!this.session || !this.session.isOpen) {
            throw new Error(noConnectionError);
        }
    }
}

