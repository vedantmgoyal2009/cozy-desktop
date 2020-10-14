/* @flow */
/* eslint-env mocha */

const should = require('should')

const metadata = require('../../core/metadata')

const Builders = require('../support/builders')
const configHelpers = require('../support/helpers/config')
const cozyHelpers = require('../support/helpers/cozy')
const pouchHelpers = require('../support/helpers/pouch')
const TestHelpers = require('../support/helpers')

/*::
import type { RemoteDir } from '../../core/remote/document'
import type { MetadataRemoteInfo, MetadataRemoteDir } from '../../core/metadata'
*/

describe('Platform incompatibilities', () => {
  if (process.platform !== 'win32') {
    it.skip(`is not tested on ${process.platform}`, () => {})
    return
  }

  let builders, cozy, helpers

  before(configHelpers.createConfig)
  before(configHelpers.registerClient)
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)

  afterEach(() => helpers.local.clean())
  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  beforeEach(async function() {
    cozy = cozyHelpers.cozy
    builders = new Builders({ cozy })
    helpers = TestHelpers.init(this)

    await helpers.local.setupTrash()
    await helpers.remote.ignorePreviousChanges()
  })

  it('add incompatible dir and file', async () => {
    await builders
      .remoteDir()
      .name('di:r')
      .create()
    await builders
      .remoteFile()
      .name('fi:le')
      .create()
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual(['di:r/', 'fi:le'])
  })

  it('add incompatible dir with two colons', async () => {
    await builders
      .remoteDir()
      .name('d:i:r')
      .create()
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual(['d:i:r/'])
  })

  it('add compatible dir with some incompatible content', async () => {
    await helpers.remote.createTree([
      'dir/',
      'dir/file',
      'dir/fi:le',
      'dir/sub:dir/',
      'dir/sub:dir/file',
      'dir/subdir/',
      'dir/subdir/file'
    ])
    await helpers.pullAndSyncAll()

    should(await helpers.local.tree()).deepEqual([
      'dir/',
      'dir/file',
      'dir/subdir/',
      'dir/subdir/file'
    ])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir/fi:le',
      'dir/sub:dir/',
      'dir/sub:dir/file'
    ])
  })

  it('rename incompatible -> incompatible', async () => {
    await helpers.remote.createTree(['d:ir/', 'f:ile'])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesByPath('/d:ir', { name: 'di:r' })
    await cozy.files.updateAttributesByPath('/f:ile', { name: 'fi:le' })
    await helpers.pullAndSyncAll()

    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual(['di:r/', 'fi:le'])
  })
  it('trash & restore incompatible', async () => {
    const remoteDocs = await helpers.remote.createTree(['d:ir/', 'f:ile'])
    await helpers.pullAndSyncAll()

    await cozy.files.trashById(remoteDocs['d:ir/']._id)
    await cozy.files.trashById(remoteDocs['f:ile']._id)
    await helpers.pullAndSyncAll()

    should(await helpers.local.tree()).be.empty()
    should(await helpers.metadataTree()).be.empty()
    should(await helpers.incompatibleTree()).be.empty()

    await cozy.files.restoreById(remoteDocs['d:ir/']._id)
    await cozy.files.restoreById(remoteDocs['f:ile']._id)
    await helpers.pullAndSyncAll()

    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual(['d:ir/', 'f:ile'])
  })

  it('destroy & recreate incompatible', async () => {
    const remoteDocs = await helpers.remote.createTree(['d:ir/', 'f:ile'])
    await helpers.pullAndSyncAll()

    await cozy.files.trashById(remoteDocs['d:ir/']._id)
    await cozy.files.trashById(remoteDocs['f:ile']._id)
    await cozy.files.destroyById(remoteDocs['d:ir/']._id)
    await cozy.files.destroyById(remoteDocs['f:ile']._id)
    await helpers.pullAndSyncAll()

    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).be.empty()

    await helpers.remote.createTree(['d:ir/', 'f:ile'])
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual(['d:ir/', 'f:ile'])
  })

  it('make compatible bottom-up', async () => {
    const remoteDocs = await helpers.remote.createTree([
      'd:ir/',
      'd:ir/sub:dir/',
      'd:ir/sub:dir/f:ile',
      'd:ir/sub:dir/subsubdir/'
    ])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesById(
      remoteDocs['d:ir/sub:dir/f:ile']._id,
      { name: 'file' }
    )
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).be.empty()
    should(await helpers.incompatibleTree()).deepEqual([
      'd:ir/',
      'd:ir/sub:dir/',
      'd:ir/sub:dir/file',
      'd:ir/sub:dir/subsubdir/'
    ])

    await cozy.files.updateAttributesById(remoteDocs['d:ir/']._id, {
      name: 'dir'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual(['dir/'])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir/sub:dir/',
      'dir/sub:dir/file',
      'dir/sub:dir/subsubdir/'
    ])

    await cozy.files.updateAttributesById(remoteDocs['d:ir/sub:dir/']._id, {
      name: 'subdir'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual([
      'dir/',
      'dir/subdir/',
      'dir/subdir/file',
      'dir/subdir/subsubdir/'
    ])
    should(await helpers.incompatibleTree()).be.empty()
  })

  it('rename dir compatible -> incompatible', async () => {
    const remoteDocs = await helpers.remote.createTree([
      'dir/',
      'dir/subdir/',
      'dir/subdir/file'
    ])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesById(remoteDocs['dir/']._id, {
      name: 'dir:'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual([
      '/Trash/dir/',
      '/Trash/dir/subdir/',
      '/Trash/dir/subdir/file'
    ])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir:/',
      'dir:/subdir/',
      'dir:/subdir/file'
    ])
  })

  it('rename dir compatible -> incompatible with already incompatible content', async () => {
    const remoteDocs = await helpers.remote.createTree([
      'dir/',
      'dir/sub:dir/',
      'dir/sub:dir/file'
    ])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesById(remoteDocs['dir/']._id, {
      name: 'dir:'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual(['/Trash/dir/'])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir:/',
      'dir:/sub:dir/',
      'dir:/sub:dir/file'
    ])
  })

  it('rename file compatible -> incompatible', async () => {
    const remoteDocs = await helpers.remote.createTree(['dir/', 'dir/file'])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesById(remoteDocs['dir/file']._id, {
      name: 'fi:le'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual(['/Trash/file', 'dir/'])
    should(await helpers.incompatibleTree()).deepEqual(['dir/fi:le'])
  })

  it('rename dir compatible -> compatible with incompatible content', async () => {
    const remoteDocs = await helpers.remote.createTree([
      'dir/',
      'dir/fi:le',
      'dir/sub:dir/'
    ])
    await helpers.pullAndSyncAll()

    await cozy.files.updateAttributesById(remoteDocs['dir/']._id, {
      name: 'dir2'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual(['dir2/'])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir2/fi:le',
      'dir2/sub:dir/'
    ])
  })

  it('move local dir with incompatible metadata & remote content', async () => {
    const remoteDocs = await helpers.remote.createTree([
      'dir/',
      'dir/sub:dir/',
      'dir/sub:dir/file'
    ])
    await helpers.pullAndSyncAll()

    // Simulate local move
    const dir = await helpers.pouch.byRemoteId(remoteDocs['dir/']._id)
    const dir2 = metadata.buildDir('dir2', {
      atime: new Date(),
      mtime: new Date(),
      ctime: new Date(),
      directory: true,
      symbolicLink: false,
      size: dir.size,
      fileid: dir.fileid,
      ino: dir.ino
    })
    await helpers.prep.moveFolderAsync('local', dir2, dir)
    await helpers.syncAll()

    should(await helpers.remote.tree()).deepEqual([
      '.cozy_trash/',
      'dir2/',
      'dir2/sub:dir/',
      'dir2/sub:dir/file'
    ])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir2/sub:dir/',
      'dir2/sub:dir/file'
    ])
  })

  it('move remote dir with incompatible metadata & remote content', async () => {
    const remoteDocs /*: { [string]: MetadataRemoteInfo } */ = await helpers.remote.createTree(
      ['dir/', 'dir/sub:dir/', 'dir/sub:dir/file']
    )
    await helpers.pullAndSyncAll()

    // Simulate remote move
    if (remoteDocs['dir/'].type !== 'directory') {
      throw new Error('Unexpected remote file with dir/ path')
    }
    const remoteDoc = remoteDocs['dir/']
    const dir = await helpers.pouch.byRemoteId(remoteDoc._id)
    const newRemoteDoc = {
      ...remoteDoc,
      _rev: '2-xxxxxx',
      name: 'dir2',
      path: '/dir2',
      updated_at: new Date().toISOString()
    }
    const { name, dir_id, updated_at } = newRemoteDoc
    await helpers.remote.side.remoteCozy.updateAttributesById(
      remoteDoc._id,
      { name, dir_id, updated_at },
      { ifMatch: remoteDoc._rev }
    )
    const dir2 = metadata.fromRemoteDoc(newRemoteDoc)
    await helpers.prep.moveFolderAsync('remote', dir2, dir)
    await helpers.syncAll()

    should(await helpers.local.tree()).deepEqual(['dir2/'])
    should(await helpers.incompatibleTree()).deepEqual([
      'dir2/sub:dir/',
      'dir2/sub:dir/file'
    ])
  })

  it('rename dir compatible -> incompatible -> compatible with compatible content', async () => {
    const remoteDocs = await helpers.remote.createTree(['dir/', 'dir/file'])
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual(['dir/', 'dir/file'])
    should(await helpers.incompatibleTree()).be.empty()

    await cozy.files.updateAttributesById(remoteDocs['dir/']._id, {
      name: 'd:ir'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual([
      '/Trash/dir/',
      '/Trash/dir/file'
    ])
    should(await helpers.incompatibleTree()).deepEqual(['d:ir/', 'd:ir/file'])

    await cozy.files.updateAttributesById(remoteDocs['dir/']._id, {
      name: 'dir'
    })
    await helpers.pullAndSyncAll()
    should(await helpers.local.tree()).deepEqual([
      // XXX: We don't restore from OS trash for now. Hence the copy.
      '/Trash/dir/',
      '/Trash/dir/file',
      'dir/',
      'dir/file'
    ])
    should(await helpers.incompatibleTree()).be.empty()
  })
})
