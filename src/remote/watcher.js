/* @flow */

import * as conversion from '../conversion'
import EventEmitter from 'events'
import logger from '../logger'
import { ensureValidPath } from '../metadata'
import Pouch from '../pouch'
import Prep from '../prep'
import RemoteCozy from './cozy'
import { TRASH_DIR_NAME } from './constants'

import type { Metadata } from '../metadata'
import type { RemoteDoc } from './document'

const log = logger({
  component: 'RemoteWatcher'
})

export const DEFAULT_HEARTBEAT: number = 1000 * 60 // 1 minute
export const HEARTBEAT: number = parseInt(process.env.COZY_DESKTOP_HEARTBEAT) || DEFAULT_HEARTBEAT

const SIDE = 'remote'

// Get changes from the remote Cozy and prepare them for merge
export default class RemoteWatcher {
  pouch: Pouch
  prep: Prep
  remoteCozy: RemoteCozy
  events: EventEmitter
  intervalID: ?number
  runningResolve: ?() => void

  constructor (pouch: Pouch, prep: Prep, remoteCozy: RemoteCozy, events: EventEmitter) {
    this.pouch = pouch
    this.prep = prep
    this.remoteCozy = remoteCozy
    this.events = events
  }

  start () {
    const started = this.watch()
    const running = started.then(() => {
      return new Promise((resolve, reject) => {
        this.runningResolve = resolve
        this.intervalID = setInterval(() => {
          this.watch().catch(err => reject(err))
        }, HEARTBEAT)
      })
    })
    return {
      started: started,
      running: running
    }
  }

  stop () {
    if (this.intervalID) {
      clearInterval(this.intervalID)
      this.intervalID = null
    }
    if (this.runningResolve) {
      this.runningResolve()
    }
  }

  async watch () {
    try {
      const seq = await this.pouch.getRemoteSeqAsync()
      const changes = await this.remoteCozy.changes(seq)

      if (changes.ids.length === 0) return

      await this.pullMany(changes.ids)
      await this.pouch.setRemoteSeqAsync(changes.last_seq)
      log.debug({event: 'end'}, 'No more remote changes for now')
    } catch (err) {
      if (err.status === 400) {
        throw err
      }
      log.error(err)
    }
  }

  // Pull multiple files/dirs metadata at once, given their ids
  async pullMany (ids: string[]) {
    let failedIds = []

    for (let id of ids) {
      try {
        await this.pullOne(id)
      } catch (err) {
        log.error(err)
        failedIds.push(id)
      }
    }

    if (failedIds.length > 0) {
      throw new Error(
        `Some documents could not be pulled: ${failedIds.join(', ')}`
      )
    }
  }

  // Pull a single file/dir metadata, given its id
  async pullOne (id: string): Promise<*> {
    const doc: ?RemoteDoc = await this.remoteCozy.findMaybe(id)

    if (doc != null) {
      return this.onChange(doc)
    }
  }

  async onChange (doc: RemoteDoc) {
    log.debug({event: 'change', doc})

    const was: ?Metadata = await this.pouch.byRemoteIdMaybeAsync(doc._id)
    log.debug({doc, was})

    if (['directory', 'file'].includes(doc.type)) {
      return this.putDoc(doc, was)
    } else {
      log.error(`Document ${doc._id} is not a file or a directory`)
    }
  }

  // Transform the doc and save it in pouchdb
  //
  // In both CouchDB and PouchDB, the filepath includes the name field.
  // And the _id/_rev from CouchDB are saved in the remote field in PouchDB.
  //
  // Note that the changes feed can aggregate several changes for many changes
  // for the same document. For example, if a file is created and then put in
  // the trash just after, it looks like it appeared directly on the trash.
  async putDoc (remote: RemoteDoc, was: ?Metadata): Promise<*> {
    let doc: Metadata = conversion.createMetadata(remote)
    const docType = doc.docType
    ensureValidPath(doc)
    if (doc._deleted) {
      if (!was) {
        log.debug(`${doc.path}: ${docType} was created, trashed, and removed remotely`)
        return
      }
      log.info(`${doc.path}: ${docType} was deleted remotely`)
      return this.prep.deleteDocAsync(SIDE, was)
    }
    if (this.inRemoteTrash(doc)) {
      if (!was) {
        log.info(`${doc.path}: ${docType} was created and trashed remotely`)
        return
      }
      log.info(`${doc.path}: ${docType} was trashed remotely`)
      return this.prep.trashDocAsync(SIDE, was, doc)
    }
    if (!was) {
      log.info(`${doc.path}: ${docType} was added remotely`)
      return this.prep.addDocAsync(SIDE, doc)
    }
    if (was.remote._rev === doc.remote._rev) {
      log.info(`${doc.path}: ${docType} is up-to-date`)
      return
    }
    if (!this.inRemoteTrash(doc) && was.trashed) {
      log.info(`${doc.path}: ${docType} was restored remotely`)
      return this.prep.restoreDocAsync(SIDE, doc, was)
    }
    if (was.path === doc.path) {
      log.info(`${doc.path}: ${docType} was updated remotely`)
      return this.prep.updateDocAsync(SIDE, doc)
    }
    if ((doc.docType === 'file') && (was.md5sum === doc.md5sum)) {
      log.info(`${doc.path}: ${docType} was moved remotely`)
      return this.prep.moveFileAsync(SIDE, doc, was)
    }
    if (doc.docType === 'folder') {
      log.info(`${doc.path}: ${docType} was possibly moved or renamed remotely`)
      await this.prep.deleteDocAsync(SIDE, was)
      return this.prep.addDocAsync(SIDE, doc)
    }
    // TODO: add unit test
    log.info(`${doc.path}: ${docType} was possibly renamed remotely while updated locally`)
    await this.removeRemote(was)
    return this.prep.addDocAsync(SIDE, doc)
  }

  inRemoteTrash (doc: Metadata): boolean {
    return doc.trashed || doc.path.startsWith(TRASH_DIR_NAME)
  }

  // Remove the association between a document and its remote
  // It's useful when a file has diverged (updated/renamed both in local and
  // remote) while cozy-desktop was not running.
  removeRemote (doc: Metadata) {
    log.info(`${doc.path}: Dissociating from remote...`)
    delete doc.remote
    if (doc.sides) delete doc.sides.remote
    return this.pouch.put(doc)
  }
}
