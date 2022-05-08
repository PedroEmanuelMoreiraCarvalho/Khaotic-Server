const app = require('express')();
const server = require('http').createServer(app);
const ws = require('ws')
const parser = require("socket.io-msgpack-parser");

var servers = []

const game_pendulum = 50

const maps = {
    map1: "WWWWWWWWWWWWWWWWWWWWWWWWWWGGGGGGGGBBBBBBBGGGGGGGGWWGGBBBGGGWWWWWWWGGGBBBGGWWGBBWWGGGGGBBBGGGGGWWBBGWWGBWWWGGGGGBBBGGGGGWWWBGWWGBWWGGGGGWWWWWGGGGGWWBGWWGGGGGGGGGWWWWWGGGGGGGGGWWGGGGGGWGGWWWWWGGWGGGGGGWWGWGGWWWGGGGGGGGGWWWGGWGWWGWGGWWWGGGGGGGGGGWWGGWGWWGGGGBBGGGGBBBGGGGBBGGGGWWGGGGBBGGGBBBBBGGGBBGGGGWWGGBWWGGGGBBWBBGGGGWWBGGWWGGGGGGGGGBBBBBGGGGGGGGGWWGGGGGGGGGGBBBGGGGGGGGGGWWGWGGWWWGGGGGGGGGWWWGGWGWWGWGGWWWGGGGGGGGGWWWGGWGWWGGGGBBWGGWWWWWGGWBBGGGGWWGGGGBBBGGWWWWWGGBBBGGGGWWGBWWBBBGGWWWWWGGBBBWWBGWWGBWWWGGGGGBBBGGGGGWWWBGWWGBBWWGGGGGBBBGGGGGWWBBGWWGGBBBGGGWWWWWWWGGGBBBGGWWGGGGGGGGBBBBBBBGGGGGGGGWWWWWWWWWWWWWWWWWWWWWWWWWW",

}

const metrics = {
    map_width:25,
    map_height: 25,
    tile_size: 48,
    sky : {
        sky_procetile: 10,
        sky_offset_hitbox: 3,
    }
}

function waitXseconds(seconds){
    let ticks = (seconds * 1000) / game_pendulum
    return ticks
}

function DistanceOf(x1,y1,x2,y2){
    let pitagoras = ((x1-x2)**2+(y1-y2)**2)**(0.5)
    return Math.floor(pitagoras)
}

function detectColision(rec1,rec2){
    let rectx1 = rec1.x > rec2.x ?  rec2 : rec1
    let rectx2 = rec1.x < rec2.x ?  rec2 : rec1
    let recty1 = rec1.y > rec2.y ?  rec2 : rec1
    let recty2 = rec1.y < rec2.y ?  rec2 : rec1
    
    return(
        rectx1.x+rectx1.w>rectx2.x &&
        rectx1.y+rectx1.h > rectx2.y &&
        recty1.x+recty1.w>recty2.x &&
        recty1.y+recty1.h>recty2.y
    )
}

function removeServer(port){
    servers = servers.filter((server)=>{
        return server.port != port 
    })
}

class Tile{
    constructor(x,y){
        this.x=x*metrics.tile_size
        this.y=y*metrics.tile_size
    }
    //some tiles got to tick, anothers don't
    tick(){
        return
    }
}

class Grass extends Tile{
    constructor(x,y){
        super(x,y)
        this.id = 1
    }
}

class Bush extends Tile{
    constructor(x,y){
        super(x,y)
        this.id = 2
    }

}

class Wall extends Tile{
    constructor(x,y){
        super(x,y)
        this.id = 3
    }
}

class Heal{
    constructor(x,y,game_characters){
        this.x = x
        this.y = y
        this.width = metrics.tile_size
        this.height = metrics.tile_size
        this.collited = false
        this.game_characters = game_characters
        this.heal_points = 30
    }
    heal(player){
        player.heal(this.heal_points)
        this.collited = true
    }
    tick(){
        this.game_characters.forEach((player)=>{
            if(player.player == this.author)return
            if(player.died)return
            let this_hitbox = {
                x: this.x,
                y: this.y,
                w: this.width,
                h: this.height
            }
            let player_hitbox = {
                x: player.x,
                y: player.y,
                w: player.width,
                h: player.height
            }
            detectColision(this_hitbox,player_hitbox) ? this.heal(player) : null
        })
    }
}

class Projectile{
    constructor(author,x,y,game_characters,tiles){
        this.x = x
        this.y = y
        this.width = 0
        this.height = 0
        this.author = author
        this.game_characters = game_characters
        this.tiles = tiles
        this.collited = false
    }
}

class SkyProjectile extends Projectile{
    constructor(author,x,y,angle,game_characters,tiles){
        super(author,x,y,game_characters,tiles)
        this.width = metrics.sky.sky_procetile
        this.height = metrics.sky.sky_procetile
        this.angle = angle
        this.speed = 20
        this.dx = Math.sin((Math.PI / 180) * this.angle)
        this.dy = Math.cos((Math.PI / 180) * this.angle)
    }

    onHitPlayer(character){
        this.collited = true
        character.takeDamage(15)
        character.last_damage_taken = this.author
    }

    tick(){
        this.x += this.dx * this.speed
        this.y += this.dy * this.speed

        let this_hitbox = {
            x: this.x + this.dx * this.speed,
            y: this.y + this.dy * this.speed,
            w: this.width,
            h: this.height
        }
        
        this.game_characters.forEach((player)=>{
            if(player.player == this.author)return
            if(player.died)return
            let player_hitbox = {
                x: player.x,
                y: player.y,
                w: player.width,
                h: player.height
            }
            detectColision(this_hitbox,player_hitbox) ? this.onHitPlayer(player) : null
        })
        
        this.tiles.forEach((tile)=>{
            if(tile.constructor.name != "Wall")return
            let tile_hitbox = {
                x: tile.x,
                y: tile.y,
                w: metrics.tile_size,
                h: metrics.tile_size,                
            }
            detectColision(this_hitbox,tile_hitbox) ? this.collited = true : null
        })
    }
}

class LoganProjectile extends Projectile{
    constructor(x,y,dir){
        super(x,y)
        this.dir = dir
    }

    tick(){
    }
}

class Character {
    constructor(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation){
        this.sendMessage = sendMessage
        this.addToColocation = addToColocation
        this.player = player
        this.x = x
        this.y = y
        this.width = metrics.tile_size
        this.height = metrics.tile_size
        this.max_life = 100
        this.life = this.max_life
        this.died = false
        this.hidden = false
        this.damage = 0
        this.speed = 8
        this.vector = 1
        this.up = false
        this.left = false
        this.down = false
        this.right = false
        this.can_attack = true
        this.can_hide = true
        this.dir = 1
        this.entitys = entitys
        this.players = game_characters
        this.attack_cdwn = waitXseconds(0.5)
        this.attack_cdwn_counter = 0
        this.last_damage_taken = null
        this.tiles = tiles
    }
    Up(state){
        this.up = state
    }
    Left(state){
        this.left = state
    }
    Down(state){
        this.down = state
    }
    Right(state){
        this.right = state
    }
    getTile(tilex,tiley){
        let tile = this.tiles.filter((tile)=>{
            return (tile.x/metrics.tile_size) == tilex && (tile.y/metrics.tile_size) == tiley
        }).shift()

        return(tile)
    }
    takeDamage(dmg){
        this.life -= dmg
        this.Unhide()
        this.can_hide = false
        setTimeout(() => {
            this.can_hide = true
        }, 1000);
    }
    heal(heal){
        if(this.life+heal<=this.max_life){
            this.life += heal
        }else{
            this.life = this.max_life
        }
    }
    canMoveTo(newx, newy){
        let isfree = true
        let new_player_hitbox = {
            x: newx,
            y: newy,
            w: this.width,
            h: this.height
        }
        this.tiles.forEach((tile)=>{
            if(tile.constructor.name != "Wall") return
            let tile_hitbox = {
                x: tile.x,
                y: tile.y,
                w: metrics.tile_size,
                h: metrics.tile_size
            }
            detectColision(tile_hitbox,new_player_hitbox) ? isfree = false : null
        })
        return isfree    
    }
    Move(){
        this.vector = 1
        let module_force = ()=>{return (Math.floor(((this.speed**2)/this.vector)**(0.5)*10))/10 }
        if(this.up){
            if(this.canMoveTo(this.x,this.y-module_force())){
                this.y -= module_force()
            }else{
                while(this.canMoveTo(this.x,this.y-1)){
                    this.y-=1
                }
            }
        }else if(this.down){
            if(this.canMoveTo(this.x,this.y+module_force())){
                this.y += module_force()
            }else{
                while(this.canMoveTo(this.x,this.y+1)){
                    this.y+=1
                }
            }
        }
        if(this.right){
            (this.up || this.down) ? this.vector++ : null
            if(this.canMoveTo(this.x+module_force(),this.y)){
                this.x += module_force()
            }else{
                while(this.canMoveTo(this.x+1,this.y)){
                    this.x+=1
                }
            }
            this.dir = 1
        }else if(this.left){
            (this.up || this.down) ? this.vector++ : null
            if(this.canMoveTo(this.x-module_force(),this.y)){
                this.x -= module_force()
            }else{
                while(this.canMoveTo(this.x-1,this.y)){
                    this.x-=1
                }
            }
            this.dir = -1
        }
    }
    getPlayer(id){
        let player = this.game_characters.filter((character)=>{
            return character.player.player_id == id
        }).shift()

        return player
    }
    Hide(){
        this.hidden = true
    }
    Unhide(){
        this.hidden = false
    }
    HideDetection(){
        let tile_on_hover = this.getTile(Math.floor((this.x+metrics.tile_size/2)/metrics.tile_size),Math.floor((this.y+metrics.tile_size/2)/metrics.tile_size))
        switch(tile_on_hover.constructor.name){
            case "Bush":
                if(this.can_attack && this.can_hide){
                    this.Hide()
                }
                break
            default:
                this.Unhide()
                break
        }
    }
    checkLife(){
        if(this.died)return
        if(this.life<=0){
            this.life=0
            this.Die()
        }
    }
    Die(){
        this.died = true
        this.sendMessage(`${this.last_damage_taken.player_nick} eliminou ${this.player.player_nick}`)
        this.addToColocation(this.player)
    }
}

class Sky extends Character{
    constructor(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation){
        super(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation)
        this.width = metrics.tile_size
        this.height = metrics.tile_size
        this.damage = 10
    }

    addEntity(entity){
        this.entitys.push(entity)
    }

    Attack(angle){
        if(this.died)return
        if(!this.can_attack)return
        this.Unhide()
        this.entitys.push(new SkyProjectile(this.player,this.x+(metrics.tile_size/2)-(metrics.sky.sky_procetile/2),this.y+(metrics.tile_size/2)-(metrics.sky.sky_procetile/2),angle,this.players,this.tiles))
        this.can_attack = false
    }

    tick(){
        this.checkLife()

        this.HideDetection()

        this.Move()

        if(!this.can_attack){
            this.attack_cdwn_counter++
            if(this.attack_cdwn_counter>=this.attack_cdwn){
                this.attack_cdwn_counter = 0
                this.can_attack = true
            }
        }
    }
}

class Logan extends Character{
    constructor(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation){
        super(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation)
    }

    Attack(){
        console.log("Logan disparou um projétil")
    }
    tick(){
        this.Move()
    }
}

const characters = {
    Sky(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation){
        return(new Sky(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation))
    },
    Logan(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation){
        return(new Logan(player,x,y,entitys,game_characters,tiles,sendMessage,addToColocation))
    }
}
  
class Player{
    constructor(player_id,player_nick){
        this.player_id = player_id
        this.player_nick = player_nick
    }
}

class Server{
    constructor(players_patterns, port){
        this.port = port
        this.io = require('socket.io')(server,{
            cors: {
              origin: "*",
              methods: ["GET", "POST"]
            },
            wsEngine: ws.Server,
            parser
        }).listen(port)
        this.players = []
        this.players_patterns = players_patterns
        this.game_characters = []
        this.entitys = []
        this.tiles = []
        this.end = false
        this.heal_count = 0
        this.heal_appear = waitXseconds(45)
        this.messages = []
        this.colocation = []
        this.players_alive = this.game_characters.length
    }
    
    addPlayer(player){
        this.players.push(player)
    }

    addToColocation = (player)=>{
        this.colocation.push(player)
        this.players_alive--
        if(this.players_alive <= 1){
            let winner = this.game_characters.filter((character)=>{
                return !character.died 
            }).shift()
            this.colocation.push(winner.player)
            this.finish()
        }
    }

    sendMessage = (message)=>{
        this.messages.push(message)
        setTimeout(() => {
            this.messages.splice(message,1)
        }, 2000);
    }

    addCharacter(player,x,y,character){
        let new_character = characters[character](player,x,y,this.entitys,this.game_characters,this.tiles,this.sendMessage,this.addToColocation)
        this.game_characters.push(new_character)
        this.players_alive = this.game_characters.length
    }

    addTile(tile){
        this.tiles.push(tile)
    }

    initMap(){
        for(let w=0;w<metrics.map_width;w++){
            for(let h=0;h<metrics.map_height;h++){
                let tile_code = maps.map1[(w*metrics.map_width)+h]
                switch(tile_code){
                    case "G":
                        let grass = new Grass(w,h)
                        this.addTile(grass)
                        break
                    case "B":
                        let bush = new Bush(w,h)
                        this.addTile(bush)
                        break
                    case "W":
                        let wall = new Wall(w,h)
                        this.addTile(wall)
                        break
                    default:
                        let grass2 = new Grass(w,h)
                        this.addTile(grass2)
                        break
                }
            }
        }
    }

    getTile(tilex,tiley){
        tilex -= (tilex%metrics.tile_size)
        tiley -= (tiley%metrics.tile_size)
        let tile = this.tiles.filter((tile)=>{
            return tile.x == tilex && tile.y == tiley
        }).shift()
        return(tile)
    }

    getFreePosition(){
        let grass_tiles = this.tiles.filter((tile)=>{
            return tile.constructor.name == "Grass"
        })
        let rand_index = Math.floor((Math.random()*grass_tiles.length))
        let rand_tile = grass_tiles[rand_index]

        return {
            x: rand_tile.x,
            y: rand_tile.y
        }
    }

    addHeal(){
        this.heal_count++
        if(this.heal_count>=this.heal_appear){
            let rand_post = this.getFreePosition()
            let heal = new Heal(rand_post.x,rand_post.y,this.game_characters)
            this.entitys.push(heal)
            this.heal_count = 0
        }
    }

    tick(){
        this.addHeal()
        this.game_characters.forEach((character)=>{
            character.tick()
        })
        this.entitys.forEach((entity)=>{
            if(entity.collited){
                let rmv_entity = this.entitys.indexOf(entity)
                this.entitys.splice(rmv_entity, 1)
                return
            }
            entity.tick()
        })
        this.tiles.forEach((tile)=>{
            tile.tick()
        })
    }

    stop(){
        this.io.close()
        this.end = true
        removeServer(this.port)
    }

    finish(){
        let scoreboard = []
        this.colocation.forEach((player)=>{
            let player_score = {
                nick: player.player_nick
            }
            scoreboard.push(player_score)
        })
        this.io.emit('endgame',this.colocation)
        this.stop()
    }

    getCharacter(character_id){
        let found_character = this.game_characters.filter((character)=>{
            return character.player.player_id == character_id
        }).shift()
        return found_character
    }

    removeCharacter(character_id){
        this.game_characters = this.game_characters.filter((character)=>{
            return character.player.player_id != character_id
        })
        if(this.game_characters.length == 0){
            this.finish()
        }
    }

    listener(){
        this.io.on('connection', (socket) => {
            let socket_pattern = socket.handshake.query.pattern

            let player_pattern = this.players_patterns.filter((player_pattern)=>{
                return player_pattern.player_id == socket_pattern
            }).shift()

            let newPlayer = new Player(socket.id, player_pattern.player_nick)
            this.addPlayer(newPlayer)
            let rand_pos = this.getFreePosition()
            this.addCharacter(newPlayer,rand_pos.x,rand_pos.y,player_pattern.character)
            
            socket.on('up',(state)=>{
                this.getCharacter(socket.id).Up(state) 
            })

            socket.on('left',(state)=>{
                this.getCharacter(socket.id).Left(state) 
            })

            socket.on('down',(state)=>{
                this.getCharacter(socket.id).Down(state) 
            })

            socket.on('right',(state)=>{
                this.getCharacter(socket.id).Right(state) 
            })

            socket.on('attack',(mouse_pos)=>{
                let atk_character = this.getCharacter(socket.id)
                let diffX = mouse_pos.x
                let diffY = mouse_pos.y
                let angle = Math.atan2(diffX, diffY)*(180/Math.PI)
                atk_character.Attack(angle)
            })

            socket.on('disconnect',()=>{
                this.removeCharacter(socket.id)
            })
        })
    }

    sendGameData(){
        let game_data = {
            characters: [],
            entitys: [],
            tiles: [],
            messages: this.messages,
        }

        this.tiles.forEach((tile)=>{
            let tile_data = {
                id: tile.id,
                x: tile.x,
                y: tile.y,
            }
            game_data.tiles.push(tile_data)
        })

        this.game_characters.forEach((character)=>{
            let character_data = {
                id: character.player.player_id,
                character: character.constructor.name,
                nick: character.player.player_nick,
                dir: character.dir,
                x: character.x,
                y: character.y,
                life: character.life,
                died: character.died,
                hidden: character.hidden
            }
            game_data.characters.push(character_data)
        })
        this.entitys.forEach((entity)=>{
            let entity_data = {
                type: entity.constructor.name,
                x: entity.x,
                y: entity.y
            }
            game_data.entitys.push(entity_data)
        })
        //console.log(game_data)
        this.io.emit('gameData',game_data)
    }

    start(){
        this.initMap()
        this.listener()
        let gameloop = setInterval(() => {
            this.tick()
            this.sendGameData()
            if(this.end){
                clearInterval(gameloop)
            }
        }, game_pendulum)
    }
}

function addServer(players_patterns, port){
    let server = new Server(players_patterns, port)
    server.start()
    servers.push(server)
}

servers.forEach((server)=>{
    server.start()
})

module.exports = {
    addServer
}