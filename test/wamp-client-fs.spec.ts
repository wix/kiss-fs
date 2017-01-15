import {EventEmitter} from 'eventemitter3';
import * as Promise from 'bluebird';
import {expect} from 'chai';
import {assertFileSystemContract} from './implementation-suite'
import {EventsMatcher} from '../test-kit/drivers/events-matcher';
import {FileSystem, fileSystemEventNames} from '../src/api';
import {MemoryFileSystem} from '../src/memory-fs';
import wampServerOverFs from '../src/wamp-server-over-fs';
import {WampServerAndClient, WampServer} from '../src/wamp-server-over-fs';
import WampClientFileSystem from '../src/wamp-client-fs';
import {wampRealm} from '../src/utils';
import {Connection} from 'autobahn';


describe(`the wamp client filesystem implementation`, () => {

    let wampServer: WampServer;

    function server(): Promise<WampServerAndClient> {
        return wampServerOverFs(new MemoryFileSystem());
    }

    function getFS(): Promise<FileSystem> {
        return new WampClientFileSystem(`ws://127.0.0.1:3000/`, wampRealm).init();
    }

    const eventMatcherOptions: EventsMatcher.Options = {
        interval: 50,
        noExtraEventsGrace: 150,
        timeout: 1500
    };

    describe(`filesystem contract`, () => {
        let fs: FileSystem;
        let matcher: EventsMatcher;
        beforeEach(() => {
            matcher = new EventsMatcher(eventMatcherOptions);
            return server().then(serverAndClient => wampServer = serverAndClient.server)
                .then(() => getFS())
                .then(newFs => {
                    fs = newFs;
                    matcher.track(fs.events as any as EventEmitter, ...fileSystemEventNames);
                })
                .catch(err => console.log('err:', err));
        });

        afterEach(() => {
            return new Promise(resolve => {
                wampServer.close()
                resolve()
            })
        });

        it(`initially empty`, function() {
            return expect(fs.loadDirectoryTree()).to.become({type:'dir', name:'', fullPath:'', children:[]});
        });

        it(`loading a non-existing file - fails`, function() {
            return expect(fs.loadTextFile('foo.txt')).to.be.rejectedWith(Error);
        });

        it(`loading a directory as a file - fails`, function() {
            return fs.ensureDirectory('foo')
                .then(() => {
                    return matcher.expect([{type: 'directoryCreated', fullPath:'foo'}])
                })
                .then(() => expect(fs.loadTextFile('foo')).to.be.rejectedWith(Error))
                .then(() => matcher.expect([]));
        });

        it(`saving an illegal file name - fails`, function() {
            return expect(fs.saveFile('', 'baz')).to.be.rejectedWith(Error)
                .then(() => matcher.expect([]));
        });

        it(`ensuring existence of directory`, function() {
            const expectedStructure = {
                type:'dir', name:'', fullPath:'', children:[
                    {type:'dir', name:'foo.bar', fullPath:'foo.bar', children:[]}
                ]};
            return fs.ensureDirectory('foo.bar')
                .then(() => matcher.expect([{type: 'directoryCreated', fullPath:'foo.bar'}]))
                .then(() => expect(fs.loadDirectoryTree()).to.become(expectedStructure))
                .then(() => fs.ensureDirectory('foo.bar')) //2nd time does nothing
                .then(() => expect(fs.loadDirectoryTree()).to.become(expectedStructure))
                .then(() => matcher.expect([]))
        });

        it(`saving a file over a directory - fails`, function() {
            return fs.ensureDirectory('foo')
                .then(() => matcher.expect([{type: 'directoryCreated', fullPath:'foo'}]))
                .then(() => expect(fs.saveFile('foo', 'bar')).to.be.rejectedWith(Error))
                .then(() => expect(fs.loadDirectoryTree()).to.become({
                    type:'dir', name:'', fullPath:'', children:[
                        {type:'dir', name:'foo', fullPath:'foo', children:[]}
                    ]}))
                .then(() => matcher.expect([]));
        });

        it(`saving a file over a file in its path- fails`, function() {
            return fs.saveFile('foo', 'foo')
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'foo', newContent:'foo'}]))
                .then(() => expect(fs.saveFile('foo/bar.txt', 'bar')).to.be.rejectedWith(Error))
                .then(() => expect(fs.loadDirectoryTree()).to.become({
                    type:'dir', name:'', fullPath:'', children:[
                        {type:'file', name:'foo', fullPath:'foo'}
                    ]}))
                .then(() => matcher.expect([]));
        });

        it(`saving a new file (and a new directory to hold it)`, function() {
            return fs.saveFile('foo/bar.txt', 'baz')
                .then(() => matcher.expect([{type: 'directoryCreated', fullPath:'foo'}, {type: 'fileCreated', fullPath:'foo/bar.txt', newContent:'baz'}]))
                .then(() => expect(fs.loadDirectoryTree()).to.become({
                    type:'dir', name:'', fullPath:'', children:[
                        {type:'dir', name:'foo', fullPath:'foo', children:[
                            {type:'file', name:'bar.txt', fullPath:'foo/bar.txt'}]}]}))
                .then(() => matcher.expect([]));
        });

        it(`saving a file with different content`, function() {
            return fs.saveFile('foo.txt', 'bar')
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'foo.txt', newContent:'bar'}]))
                .then(() => expect(fs.loadTextFile('foo.txt')).to.become('bar'))
                .then(() => fs.saveFile('foo.txt', 'baz'))
                .then(() => matcher.expect([{type: 'fileChanged', fullPath:'foo.txt', newContent:'baz'}]))
                .then(() => expect(fs.loadTextFile('foo.txt')).to.become('baz'))
                .then(() => matcher.expect([]));
        });

        it(`saving a file with same content`, function() {
            return fs.saveFile('foo.txt', 'bar')
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'foo.txt', newContent:'bar'}]))
                .then(() => expect(fs.loadTextFile('foo.txt')).to.become('bar'))
                .then(() => fs.saveFile('foo.txt', 'bar')) // may or may not trigger an event
                .then(() => expect(fs.loadTextFile('foo.txt')).to.become('bar'));
        });

        it(`deleting root directory - fails`, function() {
            return expect(fs.deleteDirectory('')).to.be.rejectedWith(Error)
                .then(() => matcher.expect([]));
        });

        it(`deleting a directory`, function() {
            return fs.ensureDirectory('foo/bar')
                .then(() => matcher.expect([
                    {type: 'directoryCreated', fullPath:'foo'},
                    {type: 'directoryCreated', fullPath:'foo/bar'}]))
                .then(() => fs.deleteDirectory('foo/bar'))
                .then(() => matcher.expect([{type: 'directoryDeleted', fullPath:'foo/bar'}]))
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([
                    {children:[], fullPath:'foo', name:'foo', type:'dir'}]))
                .then(() => matcher.expect([]));
        });

        it(`deleting non existing directory succeeds`, function() {
            return fs.deleteDirectory('foo/bar')
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([]))
                .then(() => matcher.expect([]));
        });

        it(`deleting directory which is actually a file - fails`, function() {
            return fs.saveFile('foo.txt', 'foo')
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'foo.txt', newContent:'foo'}]))
                .then(() => expect(fs.deleteDirectory('foo.txt')).to.be.rejectedWith(Error))
                .then(() => matcher.expect([]));
        });

        it(`deleting non-empty directory without recursive flag - fails`, function() {
            return fs.saveFile('foo/bar/baz.txt', 'foo')
                .then(() => matcher.expect([
                    {type: 'directoryCreated', fullPath:'foo'},
                    {type: 'directoryCreated', fullPath:'foo/bar'},
                    {type: 'fileCreated', fullPath:'foo/bar/baz.txt', newContent:'foo'}]))
                .then(() => expect(fs.deleteDirectory('foo/bar')).to.be.rejectedWith(Error))
                .then(() => matcher.expect([]));
        });

        it(`deleting non-empty directory with recursive flag`, function() {
            return fs.saveFile('foo/bar/baz.txt', 'foo')
                .then(() => matcher.expect([
                    {type: 'directoryCreated', fullPath:'foo'},
                    {type: 'directoryCreated', fullPath:'foo/bar'},
                    {type: 'fileCreated', fullPath:'foo/bar/baz.txt', newContent:'foo'}]))
                .then(() => fs.deleteDirectory('foo', true))
                .then(() => matcher.expect([{type: 'directoryDeleted', fullPath:'foo'}]))
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([]))
                .then(() => matcher.expect([]));
        });

        it(`deleting file which is actually a directory - fails`, function() {
            return fs.ensureDirectory('foo.bar')
                .then(() => matcher.expect([{type: 'directoryCreated', fullPath:'foo.bar'}]))
                .then(() => expect(fs.deleteFile('foo.bar')).to.be.rejectedWith(Error))
                .then(() => matcher.expect([]));
        });

        it(`deleting only one file`, function() {
            return fs.saveFile('foo.txt', 'foo')
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'foo.txt', newContent:'foo'}]))
                .then(() => fs.saveFile('bar.txt','bar'))
                .then(() => matcher.expect([{type: 'fileCreated', fullPath:'bar.txt', newContent:'bar'}]))
                .then(() => fs.deleteFile('bar.txt'))
                .then(() => matcher.expect([{type: 'fileDeleted', fullPath:'bar.txt'}]))
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([{fullPath:'foo.txt', name:'foo.txt', type:'file'}]))
                .then(() => matcher.expect([]));
        });

        it(`deleting non existing file succeeds`, function() {
            return fs.deleteFile('bar.txt')
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([]))
                .then(() => matcher.expect([]));
        });

        it(`deleting non existing file (deep path) succeeds`, function() {
            return fs.deleteFile('foo/bar.txt')
                .then(() => expect(fs.loadDirectoryTree()).to.eventually.have.property('children').eql([]))
                .then(() => matcher.expect([]));
        });
    });

});
